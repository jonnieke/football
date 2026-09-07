import { ApiFootballProvider } from "@fcp/football-provider";
import { getPrisma, persistNormalizedFixture } from "@fcp/database";
import {
  createLogger,
  createRedis,
  errorMessage,
  loadConfig,
  Metrics,
} from "@fcp/shared";
import { v7 as uuidv7 } from "uuid";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL).child({
  worker: "football-ingestion",
});
const prisma = getPrisma(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const metrics = new Metrics();
const provider = new ApiFootballProvider(
  {
    baseUrl: config.API_FOOTBALL_BASE_URL,
    apiKey: config.API_FOOTBALL_KEY,
    timeoutMs: config.API_FOOTBALL_TIMEOUT_MS,
    maxRetries: config.API_FOOTBALL_MAX_RETRIES,
  },
  logger,
);

async function poll(): Promise<void> {
  const lockKey = "lock:football-ingestion:live";
  const lock = await redis.set(
    lockKey,
    process.pid.toString(),
    "EX",
    config.LIVE_POLL_INTERVAL_SECONDS,
    "NX",
  );
  if (lock !== "OK") return;
  const startedAt = Date.now();
  const run = await prisma.pollingRun.create({
    data: { id: uuidv7(), provider: "api-football", status: "running" },
  });
  try {
    const enabled = await prisma.competition.findMany({
      where: { enabled: true },
      select: { sourceId: true, season: true },
    });
    const enabledKeys = new Set(
      enabled.map((item) => `${item.sourceId}:${item.season}`),
    );
    const received = await provider.getLiveFixtures();
    const fixtures =
      enabledKeys.size === 0
        ? received
        : received.filter((fixture) =>
            enabledKeys.has(
              `${fixture.competition.sourceId}:${fixture.competition.season}`,
            ),
          );
    let changedFixtures = 0;
    for (const fixture of fixtures) {
      const result = await persistNormalizedFixture(prisma, fixture);
      if (result.changed && result.previousStateId !== undefined) {
        changedFixtures += 1;
      }
    }
    const durationMs = Date.now() - startedAt;
    await prisma.pollingRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        fixturesRetrieved: fixtures.length,
        changedFixtures,
        durationMs,
        finishedAt: new Date(),
      },
    });
    metrics.increment("poll_success");
    metrics.increment("fixtures_retrieved", fixtures.length);
    metrics.observe("poll_duration_ms", durationMs);
    await redis.set(
      "health:worker:football-ingestion",
      new Date().toISOString(),
      "EX",
      config.WORKER_HEARTBEAT_TTL_SECONDS,
    );
    await redis.set(
      "health:provider:api-football",
      "healthy",
      "EX",
      config.WORKER_HEARTBEAT_TTL_SECONDS * 2,
    );
    logger.info(
      {
        fixtures_retrieved: fixtures.length,
        changed_fixtures: changedFixtures,
        duration_ms: durationMs,
      },
      "live poll completed",
    );
  } catch (error) {
    metrics.increment("poll_failure");
    await prisma.pollingRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        durationMs: Date.now() - startedAt,
        errorCode: error instanceof Error ? error.name : "UNKNOWN",
        finishedAt: new Date(),
      },
    });
    await redis.set(
      "health:provider:api-football",
      "unhealthy",
      "EX",
      config.WORKER_HEARTBEAT_TTL_SECONDS * 2,
    );
    logger.error({ err: error, provider: "api-football" }, "live poll failed");
  } finally {
    const owner = await redis.get(lockKey);
    if (owner === process.pid.toString()) await redis.del(lockKey);
  }
}

async function shutdown(signal: string): Promise<void> {
  clearInterval(timer);
  logger.info({ signal }, "shutting down");
  await Promise.all([prisma.$disconnect(), redis.quit()]);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

await redis.connect();
await poll();
const timer = setInterval(() => {
  void poll().catch((error) =>
    logger.error({ err: errorMessage(error) }, "poll loop failed"),
  );
}, config.LIVE_POLL_INTERVAL_SECONDS * 1000);
