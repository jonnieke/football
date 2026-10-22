// Read-only production preflight. Never prints credential values.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
const root = new URL("../", import.meta.url);
const { Client } = createRequire(
  new URL("packages/database/package.json", root),
)("pg");
let client;
try {
  const url = new URL(
    parse(readFileSync(new URL(".env.workers.local", root))).DATABASE_URL,
  );
  if (
    !url.hostname.endsWith(".supabase.com") ||
    decodeURIComponent(url.username) !== "postgres.dsholtmeyivyjwiuzedb" ||
    url.pathname !== "/postgres"
  )
    throw Error("TARGET_MISMATCH");
  client = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: "postgres",
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(
        new URL("apps/admin/certs/supabase-ca-2021.crt", root),
        "utf8",
      ),
    },
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  client.on("error", () => {});
  await client.connect();
  const rows = (
    await client.query(
      "SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name",
    )
  ).rows;
  const directory = new URL("packages/database/prisma/migrations/", root);
  const local = readdirSync(directory, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name);
  const drift = rows
    .filter(
      (row) =>
        !row.rolled_back_at &&
        (!local.includes(row.migration_name) ||
          !row.finished_at ||
          createHash("sha256")
            .update(
              readFileSync(
                new URL(row.migration_name + "/migration.sql", directory),
              ),
            )
            .digest("hex") !== row.checksum),
    )
    .map((row) => row.migration_name);
  const pending = local.filter(
    (name) =>
      !rows.some(
        (row) =>
          row.migration_name === name && row.finished_at && !row.rolled_back_at,
      ),
  );
  console.log(JSON.stringify({ target: "football Supabase", drift, pending }));
  if (drift.length) process.exitCode = 1;
} catch {
  console.error(
    "Read-only migration preflight failed; credential details withheld.",
  );
  process.exitCode = 1;
} finally {
  await client?.end();
}
