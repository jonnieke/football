import { expect, it, vi } from "vitest";
import type { PrismaClient } from "@fcp/database";
import { dashboardReader, heartbeatState } from "./dashboard.js";

it("never treats missing, malformed, stale or future signals as current", () => {
  const now = Date.parse("2026-09-08T10:00:00Z");
  for (const value of [null, "garbage", "2027-01-01"])
    expect(heartbeatState(value, now).state).toBe("unknown");
  expect(heartbeatState("2026-09-08T09:59:50Z", now).state).toBe("recent");
  expect(heartbeatState("2026-09-08T09:58:00Z", now).state).toBe("stale");
});
it("returns unknown data, not empty success, on dependency failures", async () => {
  const transaction = vi.fn().mockRejectedValue(new Error("database secret"));
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  const redis = { get: vi.fn().mockRejectedValue(new Error("redis secret")) };
  const read = dashboardReader(prisma, redis, "test");
  const result = await read();
  expect(result).toMatchObject({
    database: "unavailable",
    redis: "unavailable",
    data: null,
    quota: { remaining: null },
  });
  expect(result.workers.every((worker) => worker.state === "unknown")).toBe(
    true,
  );
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(redis.get).toHaveBeenCalledWith(
    "test:health:worker:football-ingestion",
  );
  await read();
  expect(transaction).toHaveBeenCalledTimes(1);
});
it("bounds lists and queries within a read-only transaction", async () => {
  const find = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    competition: find(),
    pollingRun: find(),
    fixture: find(),
    contentItem: find(),
    workOutbox: { count: vi.fn().mockResolvedValue(0) },
    sourceEventReview: { count: vi.fn().mockResolvedValue(0) },
  };
  const transaction = vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) =>
    fn(tx),
  );
  const result = await dashboardReader(
    { $transaction: transaction } as unknown as PrismaClient,
    { get: () => Promise.resolve(null) },
    "bull",
  )();
  expect(result.database).toBe("connected");
  expect(result.data?.pending).toBe(0);
  expect(tx.$executeRaw.mock.calls[0]?.[0]).toEqual([
    "SET TRANSACTION READ ONLY",
  ]);
  expect(tx.fixture.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 20 }),
  );
  expect(tx.contentItem.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 20 }),
  );
  expect(transaction).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({ timeout: 8000 }),
  );
});
