// Run only after the reviewed atomic bootstrap has committed and been verified.
// Uses Prisma's own resolve command, not hand-written migration ledger rows.
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
const root = new URL("../", import.meta.url);
const names = [
  "20260828000000_init",
  "20260907000000_durable_outbox",
  "20260908000000_fixture_observations",
  "20260909000000_source_event_reviews",
  "20260910000000_commit_ordered_feed",
  "20260911000000_alert_recipients",
];
try {
  const env = parse(readFileSync(new URL(".env.workers.local", root)));
  const uri = new URL(env.DATABASE_URL);
  if (
    decodeURIComponent(uri.username) !== "postgres.dsholtmeyivyjwiuzedb" ||
    !uri.hostname.endsWith(".supabase.com")
  )
    throw new Error();
  // Session pooling for migration tooling; the application URL is NOT modified.
  if (uri.port === "6543") uri.port = "5432";
  uri.search = "";
  uri.searchParams.set("schema", "public");
  uri.searchParams.set("sslmode", "require");
  uri.searchParams.set("sslaccept", "strict");
  uri.searchParams.set(
    "sslcert",
    "C:/Users/peterson/Downloads/prod-ca-2021.crt",
  );
  uri.searchParams.set("connect_timeout", "10");
  const selected = process.argv[2];
  if (!selected || !names.includes(selected)) throw new Error();
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("node_modules/prisma/build/index.js", root)),
      "migrate",
      "resolve",
      "--applied",
      selected,
    ],
    {
      cwd: fileURLToPath(root),
      env: { ...process.env, DATABASE_URL: uri.toString() },
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  // Prisma output includes connection details. Emit only status and known error code.
  if (result.status !== 0) {
    const code =
      ((result.stdout ?? "") + " " + (result.stderr ?? "")).match(
        /\bP\d{4}\b/,
      )?.[0] ?? "DETAILS_WITHHELD";
    console.log(
      `BASELINE_FAILED: ${selected}; ${result.error?.code === "ETIMEDOUT" ? "TIMEOUT" : code}`,
    );
    process.exitCode = 1;
  } else console.log(`BASELINE_RECORDED: ${selected}`);
} catch {
  console.log(
    "BASELINE_FAILED: configuration or tooling error (details withheld)",
  );
  process.exitCode = 1;
}
