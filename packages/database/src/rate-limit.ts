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
  if (!Array.isArray(result) || result.length !== 2)
    throw new Error("Unexpected Redis rate-limit response");
  const count = Number(result[0]);
  const ttl = Math.max(1, Number(result[1]));
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: ttl,
  };
}
