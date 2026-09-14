import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { createHash } from "node:crypto";
import { parse } from "dotenv";

const root = new URL("../", import.meta.url);
const requireDatabase = createRequire(
  new URL("packages/database/package.json", root),
);
const { Client } = requireDatabase("pg");
let client;
const timer = setTimeout(() => {
  console.log("DATABASE_CHECK_TIMEOUT");
  process.exit(1);
}, 30000);
try {
  const env = parse(readFileSync(new URL(".env.workers.local", root)));
  const uri = new URL(env.DATABASE_URL);
  const schema = uri.searchParams.get("schema") ?? "public";
  if (
    !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema) ||
    !/^(postgres|postgresql):$/.test(uri.protocol) ||
    !(
      uri.hostname.endsWith(".supabase.com") ||
      uri.hostname.endsWith(".supabase.co")
    )
  )
    throw new Error("INVALID_TARGET");
  client = new Client({
    host: uri.hostname,
    port: Number(uri.port || 5432),
    user: decodeURIComponent(uri.username),
    password: decodeURIComponent(uri.password),
    database: decodeURIComponent(uri.pathname.slice(1)),
    ssl: { rejectUnauthorized: true, servername: uri.hostname },
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  client.on("error", () => {});
  await client.connect();
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  await client.query("SET LOCAL statement_timeout = '5s'");
  console.log("DATABASE_TLS_CONNECTION: PASS");
  const expected = [
    ...readFileSync(
      new URL("packages/database/prisma/schema.prisma", root),
      "utf8",
    ).matchAll(/@@map\("([a-z_]+)"\)/g),
  ].map((m) => m[1]);
  const tables = (
    await client.query(
      "SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r' AND c.relname=ANY($2::text[])",
      [schema, [...expected, "_prisma_migrations"]],
    )
  ).rows;
  const present = new Set(tables.map((t) => t.name));
  console.log(
    JSON.stringify({
      expected_tables: expected.length,
      present_tables: expected.filter((t) => present.has(t)).length,
      missing_tables: expected.filter((t) => !present.has(t)),
      application_tables_without_rls: tables
        .filter((t) => expected.includes(t.name) && !t.rls)
        .map((t) => t.name),
    }),
  );
  const migrations = readdirSync(
    new URL("packages/database/prisma/migrations/", root),
  ).filter((n) => /^\d{14}_/.test(n));
  if (present.has("_prisma_migrations")) {
    const rows = (
      await client.query(
        `SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "${schema}"."_prisma_migrations"`,
      )
    ).rows;
    const checksumMismatches = migrations.filter((n) => {
      const hash = createHash("sha256")
        .update(
          readFileSync(
            new URL(
              `packages/database/prisma/migrations/${n}/migration.sql`,
              root,
            ),
          ),
        )
        .digest("hex");
      return rows.some(
        (r) =>
          r.migration_name === n &&
          r.finished &&
          !r.rolled_back &&
          r.checksum !== hash,
      );
    });
    console.log(
      JSON.stringify({
        pending_migrations: migrations.filter(
          (n) =>
            !rows.some(
              (r) => r.migration_name === n && r.finished && !r.rolled_back,
            ),
        ),
        unfinished_migrations: rows.filter((r) => !r.finished && !r.rolled_back)
          .length,
        checksum_mismatches: checksumMismatches,
      }),
    );
  } else
    console.log(
      "MIGRATION_HISTORY: absent; application migrations not verified",
    );
  for (const [table, where] of [
    ["competitions", "enabled = true"],
    ["work_outbox", "completed_at IS NULL"],
    ["source_event_reviews", "status = 'pending'"],
    ["fixtures", "true"],
    ["content_items", "true"],
  ]) {
    if (present.has(table)) {
      const result = await client.query(
        `SELECT count(*)::text AS count FROM "${schema}"."${table}" WHERE ${where}`,
      );
      console.log(`${table}_count: ${result.rows[0].count}`);
    }
  }
  await client.query("ROLLBACK");
  console.log(
    "READ_ONLY_CHECK_COMPLETE: no migrations, seeds, jobs, or provider requests executed",
  );
} catch (error) {
  // Never emit raw driver messages, URLs, or credentials.
  const code = String(error?.code ?? "");
  const known = [
    "28P01",
    "42501",
    "42703",
    "42P01",
    "57014",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ];
  console.log(
    `DATABASE_CHECK_FAILED: ${known.includes(code) ? code : "CONNECTION_OR_SCHEMA_CHECK_FAILED"}`,
  );
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
  clearTimeout(timer);
}
