import { Worker } from "bullmq";
import { getPrisma, processContentDelivery } from "@fcp/database";
import {
  createLogger,
  createRedis,
  redisKey,
  loadConfig,
  Metrics,
  QUEUE_NAMES,
  type ContentGenerationJob,
} from "@fcp/shared";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL).child({
  worker: "content-generator",
});
const prisma = getPrisma(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const metrics = new Metrics();

await redis.connect();
const worker = new Worker<ContentGenerationJob>(
  QUEUE_NAMES.contentGeneration,
  async (job) => {
    const item = await processContentDelivery(
      prisma,
      job.data,
      config.SHORT_CONTENT_MAX_LENGTH,
    );
    if (item !== null) {
      metrics.increment("content_generated");
      logger.info(
        { event_id: item.eventId, content_id: item.id, channel: item.channel },
        "content generated",
      );
    }
    await redis.set(
      redisKey("health:worker:content-generator", config.QUEUE_PREFIX),
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
    { err: error, event_id: job?.data.eventId, outbox_id: job?.data.outboxId },
    "content generation failed",
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
