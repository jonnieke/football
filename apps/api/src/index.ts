import { getPrisma } from "@fcp/database";
import { createLogger, createProducerRedis, loadConfig } from "@fcp/shared";
import { buildApp } from "./app.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const prisma = getPrisma(config.DATABASE_URL);
const redis = createProducerRedis(config.REDIS_URL);
redis.on("error", () => logger.warn("API Redis connection error"));
await redis.connect();
const app = await buildApp({ config, prisma, redis, logger });

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down API");
  await app.close();
  await Promise.all([prisma.$disconnect(), redis.quit()]);
}
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

await app.listen({ host: config.HOST, port: config.PORT });
