import { Worker } from "bullmq";
import {
  processFixtureDelivery,
  getPrisma,
  prepareFixtureObservation,
} from "@fcp/database";
import {
  createLogger,
  createRedis,
  redisKey,
  loadConfig,
  Metrics,
  QUEUE_NAMES,
  type FixtureChangeJob,
} from "@fcp/shared";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL).child({
  worker: "event-processor",
});
const prisma = getPrisma(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const metrics = new Metrics();

await redis.connect();
const worker = new Worker<FixtureChangeJob>(
  QUEUE_NAMES.fixtureChanges,
  async (job) => {
    const processed = await processFixtureDelivery(
      prisma,
      job.data,
      (payload) => prepareFixtureObservation(prisma, payload),
    );
    metrics.increment("events_detected", processed.created);
    metrics.increment("duplicates_ignored", processed.duplicates);
    await redis.set(
      redisKey("health:worker:event-processor", config.QUEUE_PREFIX),
      new Date().toISOString(),
      "EX",
      config.WORKER_HEARTBEAT_TTL_SECONDS,
    );
  },
  { connection: redis, concurrency: 10, prefix: config.QUEUE_PREFIX },
);

worker.on("failed", (job, error) => {
  metrics.increment("worker_failures");
  logger.error(
    { err: error, fixture_id: job?.data.fixtureId },
    "event processing failed",
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  await worker.close();
  await Promise.all([prisma.$disconnect(), redis.quit()]);
}
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
