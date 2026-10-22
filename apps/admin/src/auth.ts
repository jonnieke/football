import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
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
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, field: string): Promise<number>;
  eval(
    script: string,
    count: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}
const scrypt = promisify(scryptCallback);
export type AdminRole = "viewer" | "editor" | "admin";
export interface AdminUser {
  email: string;
  role: AdminRole;
  passwordHash: string;
  disabled: boolean;
  createdAt: string;
  sessionVersion: number;
}
const roles = new Set<AdminRole>(["viewer", "editor", "admin"]);
function decodeUser(value: string | undefined): AdminUser | null {
  if (!value) return null;
  try {
    const user = JSON.parse(value) as AdminUser;
    if (
      typeof user.email === "string" &&
      roles.has(user.role) &&
      typeof user.passwordHash === "string" &&
      typeof user.disabled === "boolean" &&
      typeof user.createdAt === "string" &&
      Number.isSafeInteger(user.sessionVersion) && user.sessionVersion > 0
    ) return user;
  } catch { /* malformed records fail closed */ }
  return null;
}
async function passwordDigest(password: string, salt: Buffer) {
  return (await scrypt(password, salt, 64)) as Buffer;
}
async function encodePassword(password: string) {
  const salt = randomBytes(16);
  const digest = await passwordDigest(password, salt);
  return `scrypt:${salt.toString("base64url")}:${digest.toString("base64url")}`;
}
async function verifyPassword(password: string, stored: string) {
  const [scheme, saltText, digestText] = stored.split(":");
  if (scheme !== "scrypt" || !saltText || !digestText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(digestText, "base64url");
    if (salt.length !== 16 || expected.length !== 64) return false;
    return timingSafeEqual(await passwordDigest(password, salt), expected);
  } catch { return false; }
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
  const userKey = `${prefix}:users`;
  const emailKey = (email: string) => hash(email.trim().toLowerCase());
  const findUser = async (email: string) =>
    decodeUser((await redis.hgetall(userKey))[emailKey(email)]);
  const makeSession = async (email: string, role: AdminRole, sessionVersion?: number) => {
    const session = secret();
    await redis.set(key("session", session), JSON.stringify({ email, role, ...(sessionVersion === undefined ? {} : { sessionVersion }) }), "EX", 28800);
    return session;
  };
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
      const user = await findUser(email);
      return makeSession(email, "admin", user?.sessionVersion);
    },
    async identity(session: string | undefined) {
      if (!validSecret(session)) return null;
      const saved = await redis.get(key("session", session));
      if (saved === null) return null;
      let email: string;
      let sessionVersion: number | undefined;
      try {
        const parsed = JSON.parse(saved) as { email?: unknown; sessionVersion?: unknown };
        email = typeof parsed.email === "string" ? parsed.email : "";
        sessionVersion = typeof parsed.sessionVersion === "number" ? parsed.sessionVersion : undefined;
      } catch { email = saved; } // Existing sessions from before role support.
      const user = await findUser(email);
      if (config.admins.has(email) && !user) return email;
      return user && !user.disabled && user.sessionVersion === sessionVersion ? user.email : null;
    },
    async role(email: string): Promise<AdminRole | null> {
      if (config.admins.has(email)) return "admin";
      const user = await findUser(email);
      return user && !user.disabled ? user.role : null;
    },
    async login(email: string, password: string) {
      const user = await findUser(email);
      if (!user || user.disabled || !(await verifyPassword(password, user.passwordHash))) return null;
      return makeSession(user.email, user.role, user.sessionVersion);
    },
    async users() {
      const stored = await redis.hgetall(userKey);
      return Object.values(stored)
        .map(decodeUser)
        .filter((u): u is AdminUser => Boolean(u))
        .sort((a, b) => a.email.localeCompare(b.email))
        .map(({ passwordHash: _passwordHash, ...user }) => user);
    },
    async saveUser(input: { email: string; role: AdminRole; password: string }) {
      const email = input.email.trim().toLowerCase();
      const user: AdminUser = {
        email,
        role: input.role,
        passwordHash: await encodePassword(input.password),
        disabled: false,
        createdAt: new Date().toISOString(),
        sessionVersion: 1,
      };
      await redis.hset(userKey, emailKey(email), JSON.stringify(user));
      return { email: user.email, role: user.role, disabled: user.disabled, createdAt: user.createdAt };
    },
    async updateUser(input: { email: string; role: AdminRole; password?: string; disabled: boolean }) {
      const email = input.email.trim().toLowerCase();
      const existing = await findUser(email);
      if (!existing) return null;
      const user: AdminUser = {
        ...existing,
        role: input.role,
        disabled: input.disabled,
        sessionVersion: existing.sessionVersion + 1,
        ...(input.password ? { passwordHash: await encodePassword(input.password) } : {}),
      };
      await redis.hset(userKey, emailKey(email), JSON.stringify(user));
      return { email: user.email, role: user.role, disabled: user.disabled, createdAt: user.createdAt };
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
