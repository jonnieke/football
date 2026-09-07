import { z } from "zod";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export function adminConfig(env: NodeJS.ProcessEnv) {
  const schema = z.object({
    NODE_ENV: z
      .enum(["production", "development", "test"])
      .default("production"),
    ADMIN_ORIGIN: z.url(),
    ADMIN_EMAILS: z.string().min(1),
    ADMIN_NAMESPACE: z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/),
    RESEND_FROM: email,
    RESEND_API_KEY: z.string().min(10),
  });
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error("Invalid administrator configuration");
  const config = parsed.data;
  const origin = new URL(config.ADMIN_ORIGIN);
  const local =
    config.NODE_ENV !== "production" &&
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (
    (!local && origin.protocol !== "https:") ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("ADMIN_ORIGIN must be a secure, fixed origin");
  const admins = z
    .array(email)
    .min(1)
    .max(50)
    .safeParse(config.ADMIN_EMAILS.split(","));
  if (!admins.success) throw new Error("Invalid administrator allowlist");
  return {
    ...config,
    origin: origin.origin,
    admins: new Set(admins.data),
    secure: !local,
  };
}
export type AdminConfig = ReturnType<typeof adminConfig>;
