import { createProducerRedis } from "@fcp/shared";
import type { AuthRedis } from "./auth.js";

interface Connection extends AuthRedis {
  connect(): Promise<unknown>;
  disconnect(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
}

export function redisFailureReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const allowed = [
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "SELF_SIGNED_CERT_IN_CHAIN",
  ];
  if (typeof code === "string" && allowed.includes(code)) return code;
  const message = error instanceof Error ? error.message : "";
  if (/WRONGPASS|NOAUTH/.test(message)) return "AUTHENTICATION";
  if (/NOPERM/.test(message)) return "PERMISSION";
  if (/timeout/i.test(message)) return "TIMEOUT";
  if (/closed|not writeable/i.test(message)) return "CONNECTION_CLOSED";
  return "UNKNOWN";
}

/** Share only overlapping requests, never keep an idle socket across suspension.
 * Commands are not retried: replaying EVAL could consume a login token twice.
 */
export function createAdminRedis(
  url: string,
  factory: () => Connection = () => {
    const client = createProducerRedis(url);
    client.options.retryStrategy = () => null;
    client.options.autoResendUnfulfilledCommands = false;
    return client;
  },
) {
  let current:
    | { client: Connection; ready: Promise<void>; users: number }
    | undefined;
  const connection = () => {
    if (!current) throw new Error("Redis request lease required");
    return current.client;
  };
  const redis: AuthRedis = {
    get: (key) => connection().get(key),
    set: (key, value, mode, seconds) =>
      connection().set(key, value, mode, seconds),
    del: (key) => connection().del(key),
    eval: (script, count, ...args) => connection().eval(script, count, ...args),
  };
  return {
    redis,
    acquire() {
      if (!current) {
        const client = factory();
        client.on("error", (error) =>
          console.error(
            JSON.stringify({
              component: "admin",
              code: "ADMIN_REDIS_UNAVAILABLE",
              reason: redisFailureReason(error),
            }),
          ),
        );
        current = {
          client,
          ready: client.connect().then(() => undefined),
          users: 0,
        };
      }
      const lease = current;
      lease.users++;
      let released = false;
      return {
        ready: lease.ready,
        release() {
          if (released) return;
          released = true;
          if (--lease.users === 0) {
            lease.client.disconnect();
            if (current === lease) current = undefined;
          }
        },
      };
    },
    close() {
      current?.client.disconnect();
      current = undefined;
    },
  };
}
