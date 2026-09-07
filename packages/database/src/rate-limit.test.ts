import { describe, expect, it } from "vitest";
import { consumeRateLimit, type RateLimitRedis } from "./index.js";

class FakeRateLimitRedis implements RateLimitRedis {
  private count = 0;

  public eval(): Promise<unknown> {
    this.count += 1;
    return Promise.resolve([this.count, 60]);
  }
}

describe("Redis-backed client rate limiting", () => {
  it.each([
    [NaN, 60],
    [1, NaN],
    [1, null],
    [-1, 60],
    [1, 61],
    [1.5, 60],
  ])("rejects malformed Redis counters %j", async (count, ttl) => {
    const redis = { eval: () => Promise.resolve([count, ttl]) };
    await expect(consumeRateLimit(redis, "client", 2)).rejects.toThrow();
  });
  it("allows through the limit and rejects subsequent requests", async () => {
    const redis = new FakeRateLimitRedis();
    await expect(consumeRateLimit(redis, "client", 2)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(consumeRateLimit(redis, "client", 2)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(consumeRateLimit(redis, "client", 2)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });
});
