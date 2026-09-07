import { expect, it, vi } from "vitest";
import type { PrismaClient } from "@fcp/database";
import { createLogger, loadConfig } from "@fcp/shared";
import { buildApp } from "./app.js";

it.each([
  null,
  "football-ingestion",
  "outbox-dispatcher",
  "event-processor",
  "content-generator",
])("requires every worker heartbeat (missing: %s)", async (missing) => {
  const get = vi.fn((key: string) => {
    expect(key.startsWith("health_test:health:")).toBe(true);
    if (key.endsWith(`worker:${missing}`)) return Promise.resolve(null);
    return Promise.resolve(
      key.includes(":provider:") ? "healthy" : new Date().toISOString(),
    );
  });
  const app = await buildApp({
    config: loadConfig({
      DATABASE_URL: "postgresql://unused:unused@localhost:1/unused",
      REDIS_URL: "redis://localhost:1",
      API_FOOTBALL_KEY: "unused",
      API_FOOTBALL_BASE_URL: "https://example.invalid",
      CURSOR_SIGNING_SECRET: "test-secret-at-least-thirty-two-characters",
      QUEUE_PREFIX: "health_test",
    }),
    logger: createLogger("silent"),
    prisma: {
      $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
    } as unknown as PrismaClient,
    redis: {
      get,
      ping: () => Promise.resolve("PONG"),
      eval: () => Promise.resolve([1, 60]),
    },
  });
  try {
    const response = await app.inject("/v1/health");
    expect(response.statusCode).toBe(missing === null ? 200 : 503);
    expect(response.json<{ status: string }>().status).toBe(
      missing === null ? "healthy" : "unhealthy",
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(get).toHaveBeenCalledTimes(5);
  } finally {
    await app.close();
  }
});
