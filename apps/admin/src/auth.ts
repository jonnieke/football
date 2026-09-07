import { createHash, randomBytes } from "node:crypto";
import type { AdminConfig } from "./config.js";

export interface AuthRedis {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(
    script: string,
    count: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export const validSecret = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const consumeScript = `
local value = redis.call('GET', KEYS[1])
if not value then return nil end
local data = cjson.decode(value)
if data.browser ~= ARGV[1] then return nil end
redis.call('DEL', KEYS[1])
return data.email`;
const rateScript = `
local n = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

export function adminAuth(redis: AuthRedis, config: AdminConfig) {
  const prefix = `${config.ADMIN_NAMESPACE}:${hash(config.origin)}:admin`;
  const key = (kind: string, token: string) =>
    `${prefix}:${kind}:${hash(token)}`;
  return {
    async limit(
      scope: string,
      value: string,
      maximum: number,
      seconds: number,
    ) {
      const count = await redis.eval(
        rateScript,
        1,
        key(`rate:${scope}`, value),
        seconds,
      );
      if (
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 1
      )
        throw new Error("Unavailable rate limiter");
      return count <= maximum;
    },
    async issue(email: string, browser: string) {
      const token = secret();
      await redis.set(
        key("link", token),
        JSON.stringify({ email, browser: hash(browser) }),
        "EX",
        600,
      );
      return token;
    },
    async cancel(token: string) {
      await redis.del(key("link", token));
    },
    async redeem(token: string, browser: string) {
      if (!validSecret(token) || !validSecret(browser)) return null;
      const email = await redis.eval(
        consumeScript,
        1,
        key("link", token),
        hash(browser),
      );
      if (typeof email !== "string" || !config.admins.has(email)) return null;
      const session = secret();
      await redis.set(key("session", session), email, "EX", 28800);
      return session;
    },
    async identity(session: string | undefined) {
      if (!validSecret(session)) return null;
      const email = await redis.get(key("session", session));
      return email !== null && config.admins.has(email) ? email : null;
    },
    async logout(session: string | undefined) {
      if (validSecret(session)) await redis.del(key("session", session));
    },
  };
}

export async function sendLogin(
  config: AdminConfig,
  to: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `admin-login-${hash(token)}`,
    },
    body: JSON.stringify({
      from: config.RESEND_FROM,
      to: [to],
      subject: "Football Platform — administrator sign-in",
      text: `Open this link in the browser where you requested it, then confirm sign-in. It expires in 10 minutes and can only be used once.\n\n${config.origin}/auth/confirm#token=${token}\n\nIf you did not request this, ignore this email.`,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Login email unavailable");
  }
  // Acceptance is not a guarantee of inbox delivery. Never log the response body.
  await response.body?.cancel();
}
