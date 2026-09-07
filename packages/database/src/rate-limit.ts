export interface RateLimitRedis {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

const script = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then redis.call("EXPIRE", KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return { count, ttl }
`;

export async function consumeRateLimit(
  redis: RateLimitRedis,
  clientId: string,
  limit: number,
  windowSeconds = 60,
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const result = await redis.eval(
    script,
    1,
    `rate-limit:${clientId}`,
    windowSeconds,
  );
  if (
    !Array.isArray(result) ||
    result.length !== 2 ||
    typeof result[0] !== "number" ||
    typeof result[1] !== "number"
  )
    throw new Error("Unexpected Redis rate-limit response");
  const count = Number(result[0]);
  const rawTtl = Number(result[1]);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(rawTtl) ||
    rawTtl < 0 ||
    rawTtl > windowSeconds
  )
    throw new Error("Invalid Redis rate-limit counters");
  const ttl = Math.max(1, rawTtl);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: ttl,
  };
}
