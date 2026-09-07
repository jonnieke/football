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
