import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fork } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { parse } from "dotenv";
import Redis from "ioredis";

const root = new URL("../", import.meta.url);
const names = [
  "event-processor",
  "content-generator",
  "outbox-dispatcher",
  "football-ingestion",
];
const origin = "https://v3.football.api-sports.io";
const limit = 12;
const ca = "C:/Users/peterson/Downloads/prod-ca-2021.crt";
const safeCodes = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "28P01",
  "42501",
  "42P01",
  "P1001",
  "P2010",
  "TARGET_GUARD",
  "EXISTING_WORK",
  "READINESS_TIMEOUT",
  "POLL_TIMEOUT",
  "POLL_FAILED",
  "CHILD_FAILED",
]);
const report = (value) => console.log(JSON.stringify(value));
const safeCode = (error) =>
  safeCodes.has(error?.code) ? error.code : "DETAILS_REDACTED";

// This guard surrounds the existing provider's fetch; no production worker code changes.
function boundedFetch(fetcher, worker, notify) {
  let count = 0;
  return async (input, options) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (
      worker !== "football-ingestion" ||
      url.origin !== origin ||
      !["/fixtures", "/fixtures/events"].includes(url.pathname) ||
      (options?.method && options.method !== "GET") ||
      count >= limit
    )
      throw new Error("TEST_REQUEST_GUARD");
    count += 1;
    notify({ kind: "request", count });
    const response = await fetcher(input, { ...options, redirect: "error" });
    const remaining = response.headers.get("x-ratelimit-requests-remaining");
    notify({
      kind: "response",
      count,
      status: response.status,
      remaining: /^\d+$/.test(remaining ?? "") ? Number(remaining) : null,
    });
    return response;
  };
}

async function child(name) {
  if (!names.includes(name) || !process.send)
    throw new Error("CHILD_MODE_REQUIRES_SUPERVISOR");
  const notify = (value) => {
    if (process.connected) process.send(value);
  };
  globalThis.fetch = boundedFetch(globalThis.fetch, name, notify);
  // Independent deadline remains effective if the parent disappears.
  setTimeout(() => process.exit(124), 120000).unref();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    process.emit("SIGTERM");
    if (process.connected) process.disconnect();
    setTimeout(() => process.exit(124), 15000).unref();
  };
  process.on("message", (message) => {
    if (message?.kind === "stop") stop();
  });
  process.on("disconnect", stop);
  process.on("uncaughtException", (error) => {
    notify({ kind: "fatal", code: safeCode(error) });
    process.exit(1);
  });
  process.on("unhandledRejection", (error) => {
    notify({ kind: "fatal", code: safeCode(error) });
    process.exit(1);
  });
  try {
    await import(new URL(`workers/${name}/dist/index.js`, root));
  } catch (error) {
    notify({ kind: "fatal", code: safeCode(error) });
    process.exitCode = 1;
    stop();
  }
}

async function selfTest() {
  let calls = 0;
  const fake = async (_input, options) => {
    if (options.redirect !== "error") throw new Error("UNSAFE_REDIRECT");
    calls += 1;
    return { status: 200, headers: { get: () => "123" } };
  };
  const guarded = boundedFetch(fake, "football-ingestion", () => {});
  for (let i = 0; i < limit; i++) await guarded(`${origin}/fixtures`);
  for (const [fn, url] of [
    [guarded, `${origin}/fixtures`],
    [
      boundedFetch(fake, "football-ingestion", () => {}),
      "https://example.com/fixtures",
    ],
    [boundedFetch(fake, "content-generator", () => {}), `${origin}/fixtures`],
  ]) {
    let rejected = false;
    try {
      await fn(url);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("GUARD_TEST_FAILED");
  }
  if (calls !== limit) throw new Error("REQUEST_LIMIT_FAILED");
  report({
    self_test: "PASS",
    checks: [
      "request limit",
      "origin restriction",
      "worker restriction",
      "redirect refusal",
    ],
  });
}

async function supervise(verifyOnly = false) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("NODE_24_REQUIRED");
  const env = parse(readFileSync(new URL(".env.workers.local", root)));
  const db = new URL(env.DATABASE_URL);
  const redisUrl = new URL(env.REDIS_URL);
  if (
    decodeURIComponent(db.username) !== "postgres.dsholtmeyivyjwiuzedb" ||
    !db.hostname.endsWith(".supabase.com") ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    (db.searchParams.get("schema") ?? "public") !== "public" ||
    redisUrl.protocol !== "rediss:" ||
    !redisUrl.hostname.endsWith(".aivencloud.com") ||
    env.API_FOOTBALL_BASE_URL !== origin ||
    (env.QUEUE_PREFIX ?? "bull") !== "bull"
  )
    throw Object.assign(new Error(), { code: "TARGET_GUARD" });
  const { Client } = createRequire(
    new URL("packages/database/package.json", root),
  )("pg");
  const client = new Client({
    host: db.hostname,
    port: Number(db.port || 5432),
    user: decodeURIComponent(db.username),
    password: decodeURIComponent(db.password),
    database: decodeURIComponent(db.pathname.slice(1)),
    ssl: {
      rejectUnauthorized: true,
      servername: db.hostname,
      ca: readFileSync(ca, "utf8"),
    },
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
    statement_timeout: 5000,
  });
  client.on("error", () => {});
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 5000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    enableOfflineQueue: false,
    tls: { rejectUnauthorized: true, servername: redisUrl.hostname },
  });
  redis.on("error", () => {});
  const children = [];
  let requestCount = 0;
  let stopping = false;
  let failed = false;
  const killAll = () => {
    for (const { process: p } of children)
      if (p.exitCode === null && p.signalCode === null) p.kill();
  };
  const hardDeadline = setTimeout(() => {
    killAll();
    report({ test: "HARD_TIMEOUT" });
    process.exit(1);
  }, 145000);
  const stopAll = async () => {
    stopping = true;
    for (const { process: p } of children)
      if (p.connected) p.send({ kind: "stop" }, () => {});
    const force = setTimeout(killAll, 17000);
    await Promise.all(children.map((item) => item.closed));
    clearTimeout(force);
  };
  process.once("SIGINT", killAll);
  process.once("SIGTERM", killAll);
  const counts = async () =>
    (
      await client.query(
        "SELECT (SELECT count(*)::int FROM fixtures) AS fixtures, (SELECT count(*)::int FROM football_events) AS events, (SELECT count(*)::int FROM content_items) AS content_items, (SELECT count(*)::int FROM work_outbox WHERE completed_at IS NULL) AS pending_outbox",
      )
    ).rows[0];
  const beats = async () =>
    Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [
          name,
          (await redis.exists(`health:worker:${name}`)) === 1,
        ]),
      ),
    );
  try {
    await client.connect();
    await redis.connect();
    if (verifyOnly) {
      const now = new Date();
      report({
        read_only_verification: true,
        counts: await counts(),
        latest_polls: (
          await client.query(
            "SELECT status, fixtures_retrieved, changed_fixtures, duration_ms, started_at::text, finished_at::text FROM polling_runs ORDER BY started_at DESC, id DESC LIMIT 3",
          )
        ).rows,
        timestamp_check: (
          await client.query(
            "SELECT $1::timestamp::text AS local_date_binding, $2::timestamp::text AS utc_string_binding, current_timestamp::text AS database_time",
            [now, now.toISOString()],
          )
        ).rows[0],
        ingestion_lock_present:
          (await redis.exists("lock:football-ingestion:live")) === 1,
        worker_heartbeats_now: await beats(),
        provider_requests: 0,
      });
      return;
    }
    const leagues = (
      await client.query(
        "SELECT source, source_id, season FROM competitions WHERE enabled = true",
      )
    ).rows;
    const before = await counts();
    if (
      leagues.length !== 1 ||
      leagues[0].source !== "api-football" ||
      leagues[0].source_id !== "39" ||
      leagues[0].season !== 2026 ||
      before.pending_outbox !== 0
    )
      throw Object.assign(new Error(), { code: "TARGET_GUARD" });
    for (const queue of ["fixture-changes", "content-generation"]) {
      for (const key of [
        "wait",
        "active",
        "paused",
        "delayed",
        "prioritized",
        "waiting-children",
      ]) {
        if (await redis.exists(`bull:${queue}:${key}`))
          throw Object.assign(new Error(), { code: "EXISTING_WORK" });
      }
    }
    if (
      Object.values(await beats()).some(Boolean) ||
      (await redis.exists("lock:football-ingestion:live"))
    )
      throw Object.assign(new Error(), { code: "EXISTING_WORK" });
    report({
      preflight: "PASS",
      league: 39,
      season: 2026,
      before,
      max_provider_requests: limit,
      run_window_seconds: 90,
    });
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"])
      db.searchParams.delete(key);
    db.searchParams.set("sslmode", "verify-full");
    const childEnv = {
      ...process.env,
      ...env,
      DATABASE_URL: db.toString(),
      NODE_EXTRA_CA_CERTS: ca,
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      LIVE_POLL_INTERVAL_SECONDS: "300",
      SCHEDULE_POLL_INTERVAL_SECONDS: "86400",
      API_FOOTBALL_MAX_RETRIES: "0",
      API_FOOTBALL_TIMEOUT_MS: "8000",
      RECONCILE_BATCH_SIZE: "5",
      OUTBOX_POLL_INTERVAL_MS: "2000",
    };
    delete childEnv.NODE_TLS_REJECT_UNAUTHORIZED;
    delete childEnv.NODE_OPTIONS;
    const start = (name) => {
      const p = fork(fileURLToPath(import.meta.url), ["--child", name], {
        cwd: fileURLToPath(root),
        env: childEnv,
        execArgv: [],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      });
      const item = {
        process: p,
        name,
        closed: new Promise((resolve) =>
          p.once("close", (code, signal) => {
            report({ worker: name, stopped: true, exit_code: code, signal });
            if (code !== 0 || !stopping) failed = true;
            resolve();
          }),
        ),
      };
      children.push(item);
      p.on("error", () => {
        failed = true;
        report({ worker: name, start: "FAILED" });
      });
      p.on("message", (message) => {
        if (message.kind === "request") requestCount = message.count;
        if (message.kind === "fatal") failed = true;
        report({ worker: name, ...message });
      });
      // Parse only fixed log messages; discard all raw errors, stacks and stderr.
      p.stderr.resume();
      let buffer = "";
      p.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop().slice(-16384);
        for (const line of lines) {
          try {
            const log = JSON.parse(line);
            if (
              [
                "fixture observations captured",
                "poll failed",
                "event processing failed",
                "content generation failed",
                "worker connection error",
                "content generated",
              ].includes(log.msg)
            ) {
              report({
                worker: name,
                message: log.msg,
                code: safeCode(log.err),
                fixtures:
                  typeof log.fixtures_retrieved === "number"
                    ? log.fixtures_retrieved
                    : undefined,
              });
              if (log.level >= 50) failed = true;
            }
          } catch {
            /* Non-JSON output is deliberately not exposed. */
          }
        }
      });
    };
    // Compare IDs, not local Date parameters against timezone-less UTC columns.
    const baselineId = (
      await client.query(
        "SELECT id FROM polling_runs ORDER BY started_at DESC, id DESC LIMIT 1",
      )
    ).rows[0]?.id;
    const started = new Date();
    names.slice(0, 3).forEach(start);
    const readyDeadline = Date.now() + 25000;
    while (true) {
      if (failed) throw Object.assign(new Error(), { code: "CHILD_FAILED" });
      const health = await beats();
      if (names.slice(0, 3).every((n) => health[n])) {
        report({ consumers_ready: health });
        break;
      }
      if (Date.now() > readyDeadline)
        throw Object.assign(new Error(), { code: "READINESS_TIMEOUT" });
      await delay(1000);
    }
    start("football-ingestion");
    let run;
    while (Date.now() - started.getTime() < 90000) {
      await delay(1500);
      run = (
        await client.query(
          "SELECT id, status, fixtures_retrieved, changed_fixtures, duration_ms FROM polling_runs ORDER BY started_at DESC, id DESC LIMIT 1",
        )
      ).rows[0];
      if (run?.id === baselineId) run = undefined;
      if (run && run.status !== "running") break;
      if (failed) throw Object.assign(new Error(), { code: "CHILD_FAILED" });
    }
    if (!run || run.status === "running")
      throw Object.assign(new Error(), { code: "POLL_TIMEOUT" });
    report({ poll: run });
    if (run.status !== "succeeded")
      throw Object.assign(new Error(), { code: "POLL_FAILED" });
    // Allow the durable outbox/consumers a short drain window; never create fake jobs.
    await delay(8000);
    report({
      health_during_test: await beats(),
      provider_health: await redis.get("health:provider:api-football"),
      after: await counts(),
      provider_requests: requestCount,
    });
  } catch (error) {
    failed = true;
    report({
      test: "FAILED",
      code: safeCode(error),
      provider_requests: requestCount,
    });
  } finally {
    await stopAll();
    redis.disconnect();
    await client.end().catch(() => {});
    clearTimeout(hardDeadline);
    report({
      supervisor: "COMPLETE",
      all_test_processes_stopped: true,
      passed: !failed,
    });
    if (failed) process.exitCode = 1;
  }
}

try {
  if (process.argv[2] === "--child") await child(process.argv[3]);
  else if (process.argv[2] === "--self-test") await selfTest();
  else if (process.argv[2] === "--run") await supervise();
  else if (process.argv[2] === "--verify") await supervise(true);
  else
    report({
      usage:
        "Node 24: workers-smoke-test.mjs --self-test (offline), --verify (read-only remote check), or --run (LIVE database/queue writes; up to 12 provider requests)",
    });
} catch (error) {
  report({ test: "FAILED", code: safeCode(error) });
  process.exitCode = 1;
}
