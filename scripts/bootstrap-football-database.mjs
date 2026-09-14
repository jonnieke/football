// One-time, operator-approved bootstrap for this project's empty Supabase schema.
// Default is a transactional rehearsal followed by ROLLBACK; --apply commits.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { parse } from "dotenv";

const root = new URL("../", import.meta.url);
const { Client } = createRequire(
  new URL("packages/database/package.json", root),
)("pg");
const expectedMigrations = [
  "20260828000000_init",
  "20260907000000_durable_outbox",
  "20260908000000_fixture_observations",
  "20260909000000_source_event_reviews",
  "20260910000000_commit_ordered_feed",
  "20260911000000_alert_recipients",
];
const tables = [
  ...readFileSync(
    new URL("packages/database/prisma/schema.prisma", root),
    "utf8",
  ).matchAll(/@@map\("([a-z_]+)"\)/g),
].map((m) => m[1]);
let client;
let phase = "configuration";
let committed = false;
const timer = setTimeout(() => {
  console.log("BOOTSTRAP_TIMEOUT: verify database state before retrying");
  process.exit(1);
}, 90000);
try {
  const env = parse(readFileSync(new URL(".env.workers.local", root)));
  const uri = new URL(env.DATABASE_URL);
  if (
    !/^(postgres|postgresql):$/.test(uri.protocol) ||
    !uri.hostname.endsWith(".supabase.com") ||
    decodeURIComponent(uri.username) !== "postgres.dsholtmeyivyjwiuzedb" ||
    (uri.searchParams.get("schema") ?? "public") !== "public" ||
    tables.length !== 17
  )
    throw new Error("TARGET_GUARD");
  const dirs = readdirSync(
    new URL("packages/database/prisma/migrations/", root),
  )
    .filter((n) => /^\d{14}_/.test(n))
    .sort();
  if (JSON.stringify(dirs) !== JSON.stringify(expectedMigrations))
    throw new Error("MIGRATION_GUARD");
  client = new Client({
    host: uri.hostname,
    port: Number(uri.port || 5432),
    user: decodeURIComponent(uri.username),
    password: decodeURIComponent(uri.password),
    database: decodeURIComponent(uri.pathname.slice(1)),
    ssl: { rejectUnauthorized: true, servername: uri.hostname },
    connectionTimeoutMillis: 5000,
    query_timeout: 20000,
  });
  client.on("error", () => {});
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query("SET LOCAL lock_timeout = '3s'");
  await client.query("SET LOCAL search_path = public, pg_catalog");
  await client.query("SELECT pg_advisory_xact_lock(70123849)");
  phase = "existing-object-check";
  const relations = (
    await client.query(
      "SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')",
    )
  ).rows[0].count;
  const functions = (
    await client.query(
      "SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='assign_feed_publication'",
    )
  ).rows[0].count;
  console.log(
    JSON.stringify({
      existing_non_extension_relations_in_public: relations,
      conflicting_feed_functions: functions,
    }),
  );
  if (relations !== 0 || functions !== 0) throw new Error("NONEMPTY_SCHEMA");
  for (const name of dirs) {
    phase = name;
    let sql = readFileSync(
      new URL(
        `packages/database/prisma/migrations/${name}/migration.sql`,
        root,
      ),
      "utf8",
    );
    // Reviewed migrations 5 and 6 contain their own outer transaction wrappers.
    // Remove only the exact outer wrappers to retain ONE atomic transaction.
    if (sql.startsWith("BEGIN;")) {
      if (!/COMMIT;\s*$/.test(sql)) throw new Error("TRANSACTION_GUARD");
      sql = sql.replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, "");
    }
    await client.query(sql);
    console.log(`EXECUTED_IN_TRANSACTION: ${name}`);
  }
  phase = "protect-new-objects";
  for (const table of tables) {
    await client.query(
      `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON TABLE public."${table}" FROM PUBLIC, anon, authenticated, service_role`,
    );
  }
  await client.query(
    "REVOKE ALL PRIVILEGES ON FUNCTION public.assign_feed_publication() FROM PUBLIC, anon, authenticated, service_role",
  );
  await client.query(
    "ALTER FUNCTION public.assign_feed_publication() SET search_path = pg_catalog",
  );
  phase = "verify-protections";
  const result = (
    await client.query(
      "SELECT count(*)::int AS protected FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relrowsecurity AND NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
      [tables],
    )
  ).rows[0];
  if (result.protected !== 17) throw new Error("SECURITY_GUARD");
  console.log(`PROTECTED_TABLES: ${result.protected}`);
  const feed = (
    await client.query(
      "SELECT count(*)::int AS count FROM public.feed_publication_state WHERE id=1 AND high_water=0",
    )
  ).rows[0];
  if (feed.count !== 1) throw new Error("FEED_GUARD");
  phase = "commit-or-rollback";
  const apply = process.argv.length === 3 && process.argv[2] === "--apply";
  if (process.argv.length > 2 && !apply) throw new Error("ARGUMENT_GUARD");
  await client.query(apply ? "COMMIT" : "ROLLBACK");
  committed = apply;
  console.log(
    apply
      ? "BOOTSTRAP_COMMITTED: baseline migration history next; workers remain stopped"
      : "REHEARSAL_PASSED_AND_ROLLED_BACK: no persistent database changes",
  );
} catch (error) {
  if (client && !committed) await client.query("ROLLBACK").catch(() => {});
  console.log(
    `BOOTSTRAP_FAILED_AT: ${phase}; code=${/^[A-Z0-9_]{1,40}$/.test(String(error?.code ?? "")) ? error.code : "WITHHELD"}`,
  );
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
  clearTimeout(timer);
}
