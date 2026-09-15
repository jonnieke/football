import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, redisKey } from "@fcp/shared";
import type { FeedRepository, RateLimitRedis } from "@fcp/database";

export const streamQuerySchema = z
  .object({
    after: z.string().min(1).max(2048).optional(),
    channel: z.string().min(1).max(80).optional(),
    event_type: z.string().min(1).max(80).optional(),
  })
  .strict();

export function resumeCursor(after: string | undefined, header: unknown) {
  const last = z.string().min(1).max(2048).optional().parse(header);
  if (after !== undefined && last !== undefined && after !== last)
    throw new AppError(
      "INVALID_REQUEST",
      "Use after or Last-Event-ID, not conflicting positions.",
      400,
    );
  return last ?? after;
}

// Redis time and atomic admission coordinate connections across API instances.
export const acquireStreamScript = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= 3 then return 0 end
redis.call('ZADD', KEYS[1], now + 60000, ARGV[1])
redis.call('PEXPIRE', KEYS[1], 60000)
return 1
`;
export async function acquireStreamLease(
  redis: RateLimitRedis,
  clientId: string,
  prefix: string,
) {
  const key = redisKey(`stream:client:${clientId}`, prefix);
  const token = randomUUID();
  let result: unknown;
  try {
    result = await redis.eval(acquireStreamScript, 1, key, token);
  } catch {
    throw new AppError(
      "STREAM_UNAVAILABLE",
      "Stream admission is unavailable.",
      503,
    );
  }
  if (result === 0)
    throw new AppError(
      "STREAM_LIMIT_EXCEEDED",
      "At most three streams per API client are allowed.",
      429,
    );
  if (result !== 1)
    throw new AppError(
      "STREAM_UNAVAILABLE",
      "Stream admission is unavailable.",
      503,
    );
  return async () => {
    await redis.eval(
      "return redis.call('ZREM', KEYS[1], ARGV[1])",
      1,
      key,
      token,
    );
  };
}

export function sseFrame(event: string, data: unknown, id?: string) {
  if (/[\r\n\0]/.test(event) || (id !== undefined && /[\r\n\0]/.test(id)))
    throw new Error("Invalid SSE field");
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function bounded<T>(
  operation: Promise<T>,
  milliseconds = 8000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AppError(
                "STREAM_UNAVAILABLE",
                "Stream dependency timed out.",
                503,
              ),
            ),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createFeedStream(input: {
  feed: Pick<FeedRepository, "getFeed">;
  cursor: string;
  first: Awaited<ReturnType<FeedRepository["getFeed"]>>;
  scope: { channel?: string; eventType?: string };
  stillAuthorized(): Promise<boolean>;
  // Test-only dependency timing; production callers use the bounded defaults.
  pollMs?: number;
  durationMs?: number;
}) {
  const controller = new AbortController();
  const pollMs = input.pollMs ?? 1000;
  const durationMs = input.durationMs ?? 20000;
  const deadline = Date.now() + durationMs;
  async function* messages() {
    let cursor = input.cursor;
    let page = input.first;
    let checkAuthAt = 0;
    try {
      yield "retry: 1000\n\n" +
        sseFrame("ready", { next_cursor: cursor }, cursor);
      while (!controller.signal.aborted && Date.now() < deadline) {
        if (Date.now() >= checkAuthAt) {
          if (!(await bounded(input.stillAuthorized()))) {
            yield sseFrame("access_revoked", { code: "UNAUTHORIZED" });
            return;
          }
          checkAuthAt = Date.now() + 5000;
        }
        if (controller.signal.aborted || Date.now() >= deadline) break;
        if (page.items.length || page.nextCursor !== cursor) {
          yield sseFrame(
            page.items.length ? "feed" : "checkpoint",
            {
              items: page.items,
              next_cursor: page.nextCursor,
            },
            page.nextCursor,
          );
          cursor = page.nextCursor;
        } else yield ": heartbeat\n\n";
        // Full pages catch up promptly, with backpressure at every yield.
        await sleep(page.items.length === 50 ? 10 : pollMs, undefined, {
          signal: controller.signal,
        });
        if (Date.now() >= deadline) break;
        page = await bounded(
          input.feed.getFeed({ after: cursor, limit: 50, ...input.scope }),
        );
      }
      if (!controller.signal.aborted)
        yield sseFrame("reconnect", { next_cursor: cursor });
    } catch (error) {
      if (!controller.signal.aborted) {
        const reset =
          error instanceof AppError && error.code === "CURSOR_RESET_REQUIRED";
        yield sseFrame(reset ? "reset_required" : "stream_error", {
          code: reset ? "CURSOR_RESET_REQUIRED" : "STREAM_UNAVAILABLE",
        });
      }
    }
  }
  const stream = Readable.from(messages(), {
    objectMode: false,
    highWaterMark: 16384,
  });
  // Also bounds slow readers and stalled dependencies. Never outlive the lease.
  const stop = setTimeout(() => {
    controller.abort();
    stream.destroy();
  }, durationMs + 2000);
  stream.once("close", () => {
    controller.abort();
    clearTimeout(stop);
  });
  return stream;
}
