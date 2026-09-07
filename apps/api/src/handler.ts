import type { IncomingMessage, ServerResponse } from "node:http";
import { getPrisma } from "@fcp/database";
import { createLogger, createProducerRedis, loadConfig } from "@fcp/shared";
import { buildApp } from "./app.js";

// Vercel owns the HTTP listener and process lifetime. Reuse clients per instance.
let application: ReturnType<typeof initialize> | undefined;
async function initialize() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const prisma = getPrisma(config.DATABASE_URL);
  const redis = createProducerRedis(config.REDIS_URL);
  redis.on("error", () => logger.warn("API Redis connection error"));
  try {
    await redis.connect();
    const app = await buildApp({ config, prisma, redis, logger });
    await app.ready();
    return app;
  } catch (error) {
    redis.disconnect();
    await prisma.$disconnect();
    throw error;
  }
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  application ??= initialize().catch((error: unknown) => {
    application = undefined;
    throw error;
  });
  const app = await application;
  app.server.emit("request", request, response);
}
