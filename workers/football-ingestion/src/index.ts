import { setTimeout as delay } from "node:timers/promises";
import { ApiFootballProvider } from "@fcp/football-provider";
import { getPrisma, persistNormalizedFixture } from "@fcp/database";
import {
  createLogger,
  createProducerRedis,
  loadConfig,
  redisKey,
} from "@fcp/shared";
import { v7 as uuidv7 } from "uuid";
import { collectFixtures } from "./polling.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL).child({
  worker: "football-ingestion",
});
const prisma = getPrisma(config.DATABASE_URL);
const redis = createProducerRedis(config.REDIS_URL);
const provider = new ApiFootballProvider(
  {
    baseUrl: config.API_FOOTBALL_BASE_URL,
    apiKey: config.API_FOOTBALL_KEY,
    timeoutMs: config.API_FOOTBALL_TIMEOUT_MS,
    maxRetries: config.API_FOOTBALL_MAX_RETRIES,
  },
  logger,
);
const lockKey = redisKey("lock:football-ingestion:live", config.QUEUE_PREFIX);
const lockMs = 60_000;
const renewScript =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";
const releaseScript =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
let stopping = false;
let nextDiscovery = 0;
const stop = new AbortController();
redis.on("error", (error) =>
  logger.error({ err: error }, "ingestion Redis error"),
);

async function poll(): Promise<void> {
  const owner = uuidv7();
  if ((await redis.set(lockKey, owner, "PX", lockMs, "NX")) !== "OK") return;
  let lost = false;
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void redis
      .eval(renewScript, 1, lockKey, owner, lockMs)
      .then((result) => {
        if (result !== 1) lost = true;
      })
      .catch(() => {
        lost = true;
      })
      .finally(() => {
        renewing = false;
      });
  }, lockMs / 3);
  const startedAt = Date.now();
  let runId: string | undefined;
  try {
    runId = (
      await prisma.pollingRun.create({
        data: { id: uuidv7(), provider: "api-football", status: "running" },
      })
    ).id;
    const enabled = await prisma.competition.findMany({
      where: { enabled: true, source: "api-football" },
      select: { sourceId: true, season: true },
    });
    if (enabled.length === 0)
      throw new Error(
        "No enabled API-Football competitions; seed or configure competitions before polling",
      );
    const now = new Date();
    const tracked = await prisma.fixture.findMany({
      where: {
        source: "api-football",
        competition: { enabled: true },
        kickoffAt: { lte: new Date(now.getTime() + 86_400_000) },
        OR: [
          { status: { notIn: ["finished", "cancelled", "abandoned"] } },
          { kickoffAt: { gte: new Date(now.getTime() - 3 * 86_400_000) } },
        ],
      },
      orderBy: [{ lastPolledAt: "asc" }, { id: "asc" }],
      take: config.RECONCILE_BATCH_SIZE,
      select: { sourceFixtureId: true },
    });
    const discover = Date.now() >= nextDiscovery;
    const fixtures = await collectFixtures(
      provider,
      enabled,
      tracked.map((item) => item.sourceFixtureId),
      discover,
      now,
    );
    let changedFixtures = 0;
    for (const fixture of fixtures) {
      if (stopping || lost) throw new Error("Ingestion stopped or lease lost");
      // All source facts are captured before the short database transaction.
      const events = [
        "scheduled",
        "pre_match",
        "postponed",
        "cancelled",
      ].includes(fixture.status)
        ? []
        : await provider.getFixtureEvents(fixture.sourceFixtureId);
      if (lost || (await redis.get(lockKey)) !== owner)
        throw new Error("Ingestion lease lost before persistence");
      if ((await persistNormalizedFixture(prisma, fixture, events)).changed)
        changedFixtures += 1;
    }
    if (discover)
      nextDiscovery = Date.now() + config.SCHEDULE_POLL_INTERVAL_SECONDS * 1000;
    await prisma.pollingRun.update({
      where: { id: runId },
      data: {
        status: "succeeded",
        fixturesRetrieved: fixtures.length,
        changedFixtures,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
      },
    });
    await redis.set(
      redisKey("health:worker:football-ingestion", config.QUEUE_PREFIX),
      new Date().toISOString(),
      "EX",
      config.WORKER_HEARTBEAT_TTL_SECONDS,
    );
    await redis.set(
      redisKey("health:provider:api-football", config.QUEUE_PREFIX),
      "healthy",
      "EX",
      config.WORKER_HEARTBEAT_TTL_SECONDS * 2,
    );
    logger.info(
      {
        fixtures_retrieved: fixtures.length,
        changed_fixtures: changedFixtures,
      },
      "fixture observations captured",
    );
  } catch (error) {
    if (runId !== undefined)
      await prisma.pollingRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          errorCode: error instanceof Error ? error.name : "UNKNOWN",
          durationMs: Date.now() - startedAt,
          finishedAt: new Date(),
        },
      });
    await redis.set(
      redisKey("health:provider:api-football", config.QUEUE_PREFIX),
      "unhealthy",
      "EX",
      config.WORKER_HEARTBEAT_TTL_SECONDS * 2,
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
    await redis.eval(releaseScript, 1, lockKey, owner);
  }
}

function shutdown(signal: string): void {
  logger.info({ signal }, "stopping after active poll");
  stopping = true;
  stop.abort();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
await redis.connect();
try {
  // Await each poll: timers cannot overlap, and shutdown cannot close its DB mid-write.
  while (!stopping) {
    try {
      await poll();
    } catch (error) {
      logger.error({ err: error }, "poll failed");
    }
    if (!stopping)
      await delay(config.LIVE_POLL_INTERVAL_SECONDS * 1000, undefined, {
        signal: stop.signal,
      }).catch(() => undefined);
  }
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
