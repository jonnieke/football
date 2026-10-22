import { readFileSync } from "node:fs";
import type { ResultSetHeader } from "mysql2";
import { createPool, type Pool } from "mysql2/promise";
import { z } from "zod";
import { StagingPushSendError, type StagingPushSend } from "@fcp/database";

export function stagingPushConfig(env: NodeJS.ProcessEnv) {
  const result = z
    .object({
      STAGING_PUSH_ENABLED: z.literal("true"),
      STAGING_DATABASE_URL: z.url(),
      STAGING_DATABASE_SSL_CA_FILE: z.string().min(1).optional(),
      STAGING_PUSH_POLL_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(250)
        .max(60_000)
        .default(1000),
    })
    .safeParse(env);
  if (!result.success)
    throw new Error("Staging push delivery is disabled or misconfigured");
  const url = new URL(result.data.STAGING_DATABASE_URL);
  if (url.protocol !== "mysql:")
    throw new Error("Staging database must use an encrypted MySQL connection");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !url.username || !url.password || !database)
    throw new Error("Staging database URL is incomplete");
  return { ...result.data, url, database };
}

export function createStagingPool(
  config: ReturnType<typeof stagingPushConfig>,
): Pool {
  return createPool({
    host: config.url.hostname,
    port: config.url.port ? Number(config.url.port) : 3306,
    user: decodeURIComponent(config.url.username),
    password: decodeURIComponent(config.url.password),
    database: config.database,
    waitForConnections: true,
    connectionLimit: 2,
    connectTimeout: 5000,
    enableKeepAlive: true,
    ssl: {
      rejectUnauthorized: true,
      ...(config.STAGING_DATABASE_SSL_CA_FILE
        ? { ca: readFileSync(config.STAGING_DATABASE_SSL_CA_FILE, "utf8") }
        : {}),
    },
  });
}

type Execute = (
  sql: string,
  values: readonly string[],
) => Promise<readonly [Pick<ResultSetHeader, "insertId">, ...unknown[]]>;

/** Uses the receiving developer's exact table and pending-by-default contract. */
export function mysqlStagingSender(execute: Execute): StagingPushSend {
  return async (message) => {
    try {
      const [result] = await execute(
        "INSERT INTO content_schedual_allday (message, MenuCMD, MessagePushTime, UploadedBy) VALUES (?, ?, NOW(), ?)",
        [message.text, message.menuCmd, message.uploadedBy],
      );
      return String(result.insertId);
    } catch (error) {
      const mysqlError = error as { code?: string; errno?: number };
      // The partner explicitly blocks duplicates. A retry that reaches this
      // branch means the original immutable message was already accepted.
      if (mysqlError.code === "ER_DUP_ENTRY" || mysqlError.errno === 1062)
        return `duplicate:${message.id}`;
      const code = mysqlError.code ?? "STAGING_DATABASE_UNAVAILABLE";
      const nonRetryable =
        code === "ER_NO_SUCH_TABLE" ||
        code === "ER_BAD_FIELD_ERROR" ||
        code === "ER_ACCESS_DENIED_ERROR";
      throw new StagingPushSendError(!nonRetryable, code);
    }
  };
}
