import { createHash } from "node:crypto";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  apiKeyPrefix,
  consumeRateLimit,
  FeedRepository,
  type RateLimitRedis,
  verifyApiKeyHash,
} from "@fcp/database";
import type { PrismaClient } from "@fcp/database";
import { AppError, type AppConfig, Metrics } from "@fcp/shared";
import Fastify, { type FastifyInstance, type FastifyBaseLogger } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { ZodError, z } from "zod";
import "./types.js";

interface RedisApi extends RateLimitRedis {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
}

export interface ApiDependencies {
  config: AppConfig;
  prisma: PrismaClient;
  redis: RedisApi;
  logger: FastifyBaseLogger;
}

const feedQuerySchema = z.object({
  after: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  channel: z.string().min(1).max(80).optional(),
  event_type: z.string().min(1).max(80).optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  event_type: z.string().min(1).max(80).optional(),
});

const idSchema = z.object({ id: z.uuid() });

function bearerToken(header: string | undefined): string {
  if (header === undefined || !header.startsWith("Bearer ")) {
    throw new AppError(
      "UNAUTHORIZED",
      "A valid bearer API key is required.",
      401,
    );
  }
  return header.slice(7);
}

export async function buildApp(
  dependencies: ApiDependencies,
): Promise<FastifyInstance> {
  const { config, prisma, redis, logger } = dependencies;
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 64 * 1024,
    genReqId: () => `req_${uuidv7()}`,
    trustProxy: true,
    disableRequestLogging: true,
  });
  const metrics = new Metrics();
  const feed = new FeedRepository(prisma, config.CURSOR_SIGNING_SECRET);

  await app.register(helmet, { global: true });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Football Content Platform Partner API",
        version: "1.0.0",
      },
      servers: [{ url: "/v1" }],
      components: {
        securitySchemes: {
          bearerApiKey: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "API key",
          },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.decorateRequest("apiClient", null);
  app.decorateRequest("startedAtMs", 0);

  app.addHook("onRequest", async (request, reply) => {
    request.startedAtMs = Date.now();
    void reply.header("X-Request-ID", request.id);
    if (request.url === "/v1/health" || request.url.startsWith("/docs")) return;
    const token = bearerToken(request.headers.authorization);
    const prefix = apiKeyPrefix(token);
    if (prefix === null)
      throw new AppError(
        "UNAUTHORIZED",
        "A valid bearer API key is required.",
        401,
      );
    const client = await prisma.apiClient.findUnique({
      where: { keyPrefix: prefix },
    });
    if (
      client === null ||
      client.status !== "enabled" ||
      client.revokedAt !== null
    ) {
      throw new AppError(
        "UNAUTHORIZED",
        "A valid bearer API key is required.",
        401,
      );
    }
    if (!(await verifyApiKeyHash(client.keyHash, token))) {
      throw new AppError(
        "UNAUTHORIZED",
        "A valid bearer API key is required.",
        401,
      );
    }
    request.apiClient = client;
    const rate = await consumeRateLimit(redis, client.id, client.rateLimit);
    void reply.header("X-RateLimit-Limit", client.rateLimit);
    void reply.header("X-RateLimit-Remaining", rate.remaining);
    if (!rate.allowed) {
      void reply.header("Retry-After", rate.retryAfterSeconds);
      throw new AppError(
        "RATE_LIMIT_EXCEEDED",
        "The API rate limit has been exceeded.",
        429,
      );
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const durationMs = Date.now() - request.startedAtMs;
    metrics.observe("api_request_latency_ms", durationMs);
    if (reply.statusCode >= 400) metrics.increment("api_errors");
    const ipHash = createHash("sha256").update(request.ip).digest("hex");
    await prisma.apiRequestLog
      .create({
        data: {
          id: uuidv7(),
          apiClientId: request.apiClient?.id ?? null,
          requestId: request.id,
          method: request.method,
          path: request.routeOptions.url ?? request.url.split("?")[0] ?? "/",
          statusCode: reply.statusCode,
          durationMs,
          ipHash,
        },
      })
      .catch((error: unknown) => {
        request.log.error(
          { err: error, request_id: request.id },
          "failed to persist API request log",
        );
      });
  });

  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof AppError;
    const validation = error instanceof ZodError;
    const statusCode = known
      ? error.statusCode
      : validation
        ? 400
        : (error.statusCode ?? 500);
    const code = known
      ? error.code
      : statusCode === 400
        ? "INVALID_REQUEST"
        : "INTERNAL_ERROR";
    const message =
      known && error.expose
        ? error.message
        : statusCode === 400
          ? "The request is invalid."
          : "An unexpected error occurred.";
    if (statusCode >= 500)
      request.log.error(
        { err: error, request_id: request.id },
        "request failed",
      );
    void reply
      .status(statusCode)
      .send({ error: { code, message, request_id: request.id } });
  });

  app.get("/v1/health", async (_request, reply) => {
    const [database, redisResult, provider, heartbeat, outboxHeartbeat] =
      await Promise.all([
        prisma.$queryRaw`SELECT 1`
          .then(() => "healthy" as const)
          .catch(() => "unhealthy" as const),
        redis
          .ping()
          .then(() => "healthy" as const)
          .catch(() => "unhealthy" as const),
        redis.get("health:provider:api-football").catch(() => null),
        redis.get("health:worker:football-ingestion").catch(() => null),
        redis.get("health:worker:outbox-dispatcher").catch(() => null),
      ]);
    const services = {
      database,
      redis: redisResult,
      football_provider:
        provider === "healthy"
          ? "healthy"
          : provider === "unhealthy"
            ? "unhealthy"
            : "degraded",
      ingestion_worker: heartbeat === null ? "unhealthy" : "healthy",
      outbox_worker: outboxHeartbeat === null ? "unhealthy" : "healthy",
    };
    const status =
      database === "healthy" &&
      redisResult === "healthy" &&
      services.ingestion_worker === "healthy" &&
      services.outbox_worker === "healthy"
        ? services.football_provider === "healthy"
          ? "healthy"
          : "degraded"
        : "unhealthy";
    void reply.status(status === "unhealthy" ? 503 : 200);
    return { status, services };
  });

  app.get("/v1/competitions", async () => {
    const items = await prisma.competition.findMany({
      where: { enabled: true },
      orderBy: [{ priority: "desc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, country: true, season: true },
    });
    return { items };
  });

  app.get("/v1/fixtures/live", async () => {
    const items = await prisma.fixture.findMany({
      where: {
        status: {
          in: [
            "first_half",
            "half_time",
            "second_half",
            "extra_time",
            "penalty_shootout",
            "suspended",
          ],
        },
      },
      orderBy: [{ kickoffAt: "asc" }, { id: "asc" }],
      include: { competition: true, homeTeam: true, awayTeam: true },
    });
    return {
      items: items.map((fixture) => ({
        id: fixture.id,
        competition: {
          id: fixture.competition.id,
          name: fixture.competition.name,
          channel: fixture.competition.slug,
        },
        home_team: { id: fixture.homeTeam.id, name: fixture.homeTeam.name },
        away_team: { id: fixture.awayTeam.id, name: fixture.awayTeam.name },
        score: { home: fixture.homeScore, away: fixture.awayScore },
        status: fixture.status,
        minute: fixture.minute,
        kickoff_at: fixture.kickoffAt.toISOString(),
        updated_at: fixture.updatedAt.toISOString(),
      })),
    };
  });

  app.get("/v1/fixtures/:id", async (request) => {
    const { id } = idSchema.parse(request.params);
    const fixture = await prisma.fixture.findUnique({
      where: { id },
      include: {
        competition: true,
        homeTeam: true,
        awayTeam: true,
        states: { orderBy: { capturedAt: "asc" } },
      },
    });
    if (fixture === null)
      throw new AppError(
        "FIXTURE_NOT_FOUND",
        "The fixture was not found.",
        404,
      );
    return {
      item: {
        id: fixture.id,
        competition: fixture.competition,
        home_team: fixture.homeTeam,
        away_team: fixture.awayTeam,
        score: { home: fixture.homeScore, away: fixture.awayScore },
        status: fixture.status,
        minute: fixture.minute,
        kickoff_at: fixture.kickoffAt.toISOString(),
        states: fixture.states.map((state) => ({
          status: state.status,
          minute: state.minute,
          score: { home: state.homeScore, away: state.awayScore },
          captured_at: state.capturedAt.toISOString(),
        })),
      },
    };
  });

  app.get("/v1/events", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const items = await prisma.footballEvent.findMany({
      where:
        query.event_type === undefined ? {} : { eventType: query.event_type },
      take: query.limit,
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    });
    return { items };
  });

  app.get("/v1/events/:id", async (request) => {
    const { id } = idSchema.parse(request.params);
    const item = await prisma.footballEvent.findUnique({ where: { id } });
    if (item === null)
      throw new AppError("EVENT_NOT_FOUND", "The event was not found.", 404);
    return { item };
  });

  app.get("/v1/feed", async (request) => {
    const query = feedQuerySchema.parse(request.query);
    const result = await feed.getFeed({
      limit: query.limit,
      ...(query.after === undefined ? {} : { after: query.after }),
      ...(query.channel === undefined ? {} : { channel: query.channel }),
      ...(query.event_type === undefined
        ? {}
        : { eventType: query.event_type }),
    });
    return { items: result.items, next_cursor: result.nextCursor };
  });

  return app;
}
