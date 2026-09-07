import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.url(),
  OUTBOX_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(60_000)
    .default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  REDIS_URL: z.url(),
  API_FOOTBALL_BASE_URL: z.url(),
  API_FOOTBALL_KEY: z.string().min(1),
  API_FOOTBALL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(10_000),
  API_FOOTBALL_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  LIVE_POLL_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(5)
    .max(300)
    .default(15),
  SCHEDULE_POLL_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86400)
    .default(900),
  RECONCILE_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  SHORT_CONTENT_MAX_LENGTH: z.coerce
    .number()
    .int()
    .min(80)
    .max(500)
    .default(160),
  DEFAULT_API_RATE_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(120),
  WORKER_HEARTBEAT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(600)
    .default(60),
  CURSOR_SIGNING_SECRET: z.string().min(32),
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return result.data;
}
