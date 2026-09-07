import { setTimeout as delay } from "node:timers/promises";
import { dispatchOutbox, getPrisma } from "@fcp/database";
import {
  createLogger,
  createProducerRedis,
  createQueues,
  redisKey,
  loadConfig,
} from "@fcp/shared";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL).child({
  worker: "outbox-dispatcher",
});
const prisma = getPrisma(config.DATABASE_URL);
const redis = createProducerRedis(config.REDIS_URL);
redis.on("error", (error) =>
  logger.warn({ err: error }, "outbox Redis connection error"),
);
const queues = createQueues(redis, config.QUEUE_PREFIX);
for (const queue of [queues.fixtureChanges, queues.contentGeneration]) {
  queue.on("error", (error) =>
    logger.warn({ err: error }, "outbox queue connection error"),
  );
}
let stopping = false;
const wake = new AbortController();
function stop() {
  stopping = true;
  wake.abort();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Queue operation timed out")),
          5000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Queue constructors initialize the lazy connection. Failed deliveries stay in
// PostgreSQL; reconnecting Redis will allow a later iteration to retry them.
try {
  while (!stopping) {
    try {
      const result = await dispatchOutbox(
        prisma,
        async (work) => {
          if (stopping) throw new Error("Dispatcher stopping");
          const options = {
            jobId: work.id,
            attempts: 5,
            backoff: { type: "exponential", delay: 500 },
            removeOnComplete: true,
            removeOnFail: true,
          };
          if (work.kind === "fixture_change") {
            await bounded(
              queues.fixtureChanges.add(
                "process-fixture-change",
                { ...work.payload, outboxId: work.id },
                options,
              ),
            );
          } else {
            await bounded(
              queues.contentGeneration.add(
                "generate-content",
                { ...work.payload, outboxId: work.id },
                options,
              ),
            );
          }
        },
        new Date(),
        config.OUTBOX_BATCH_SIZE,
      );
      if (result.delivered || result.failed || result.paused)
        logger.info(result, "outbox dispatch batch");
      await bounded(
        redis.set(
          redisKey("health:worker:outbox-dispatcher", config.QUEUE_PREFIX),
          new Date().toISOString(),
          "EX",
          config.WORKER_HEARTBEAT_TTL_SECONDS,
        ),
      );
    } catch (error) {
      logger.error({ err: error }, "outbox dispatch iteration failed");
    }
    if (!stopping) {
      try {
        await delay(config.OUTBOX_POLL_INTERVAL_MS, undefined, {
          signal: wake.signal,
        });
      } catch (error) {
        if (!stopping) throw error;
      }
    }
  }
} finally {
  // Never block shutdown indefinitely waiting for an unavailable Redis server.
  try {
    await bounded(
      Promise.all([
        queues.fixtureChanges.close(),
        queues.contentGeneration.close(),
      ]),
    );
  } finally {
    redis.disconnect();
    await prisma.$disconnect();
  }
}
