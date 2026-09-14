// Restrict only the migration ledger created by this approved bootstrap.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { parse } from "dotenv";
const root = new URL("../", import.meta.url);
const { Client } = createRequire(
  new URL("packages/database/package.json", root),
)("pg");
let c;
const timer = setTimeout(() => {
  console.log("HISTORY_PROTECTION_TIMEOUT");
  process.exit(1);
}, 20000);
try {
  const u = new URL(
    parse(readFileSync(new URL(".env.workers.local", root))).DATABASE_URL,
  );
  if (
    !u.hostname.endsWith(".supabase.com") ||
    decodeURIComponent(u.username) !== "postgres.dsholtmeyivyjwiuzedb"
  )
    throw Error();
  c = new Client({
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    ssl: { rejectUnauthorized: true, servername: u.hostname },
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  c.on("error", () => {});
  await c.connect();
  await c.query("BEGIN");
  await c.query("SET LOCAL statement_timeout = '5s'");
  await c.query(
    "ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY",
  );
  await c.query(
    "REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM PUBLIC, anon, authenticated, service_role",
  );
  const tables = [
    ...readFileSync(
      new URL("packages/database/prisma/schema.prisma", root),
      "utf8",
    ).matchAll(/@@map\("([a-z_]+)"\)/g),
  ].map((m) => m[1]);
  tables.push("_prisma_migrations");
  const rows = (
    await c.query(
      "SELECT c.relname, c.relrowsecurity, r.rolname, has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_access, has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') AS column_access FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND r.rolname=ANY($2::text[])",
      [tables, ["anon", "authenticated", "service_role"]],
    )
  ).rows;
  if (
    rows.length !== 54 ||
    rows.some((r) => !r.relrowsecurity || r.table_access || r.column_access)
  )
    throw Error();
  const fn = (
    await c.query(
      "SELECT r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') AS executable,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND p.proname='assign_feed_publication' AND r.rolname=ANY($1::text[])",
      [["anon", "authenticated", "service_role"]],
    )
  ).rows;
  if (
    fn.length !== 3 ||
    fn.some(
      (r) =>
        r.executable ||
        r.prosecdef ||
        !r.proconfig?.includes("search_path=pg_catalog"),
    )
  )
    throw Error();
  await c.query("COMMIT");
  console.log(
    "SECURITY_VERIFIED: RLS on 18 tables including migration ledger; zero table/column access for anon, authenticated, or service_role; feed trigger function is invoker-only with fixed search path and no direct Data API execution grants.",
  );
} catch {
  if (c) await c.query("ROLLBACK").catch(() => {});
  console.log("HISTORY_PROTECTION_OR_SECURITY_CHECK_FAILED: details withheld");
  process.exitCode = 1;
} finally {
  if (c) await c.end().catch(() => {});
  clearTimeout(timer);
}
