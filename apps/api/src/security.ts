import { consumeRateLimit, type RateLimitRedis } from "@fcp/database";
import { AppError } from "@fcp/shared";

export async function checkedRateLimit(
  redis: RateLimitRedis,
  key: string,
  limit: number,
) {
  try {
    return await consumeRateLimit(redis, key, limit);
  } catch {
    throw new AppError(
      "AUTH_SERVICE_UNAVAILABLE",
      "Authentication is temporarily unavailable.",
      503,
    );
  }
}

/** Instance-local memory/CPU safety cap; Redis supplies cross-instance attempt limits. */
export function verificationGate(limit: number) {
  let active = 0;
  return async <T>(verify: () => Promise<T>): Promise<T> => {
    if (active >= limit)
      throw new AppError(
        "AUTH_CAPACITY_EXCEEDED",
        "Authentication is busy. Retry shortly.",
        503,
      );
    active += 1;
    try {
      return await verify();
    } finally {
      active -= 1;
    }
  };
}
