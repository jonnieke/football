import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { parse } from "dotenv";
import Redis from "ioredis";
const deadline = setTimeout(() => {
  console.log("CUTOVER_CHECK_TIMEOUT");
  process.exit(1);
}, 30000);
let safe = true;
try {
  for (const [label, file] of [
    ["current-api", "../.env.redis-before-cutover.local"],
    ["target-aiven", "../.env.workers.local"],
  ]) {
    const env = parse(readFileSync(new URL(file, import.meta.url)));
    const url = new URL(env.REDIS_URL);
    const prefix = env.QUEUE_PREFIX ?? "bull";
    if (
      prefix !== "bull" ||
      !["redis:", "rediss:"].includes(url.protocol) ||
      !(label === "target-aiven"
        ? url.protocol === "rediss:" && url.hostname.endsWith(".aivencloud.com")
        : url.hostname.endsWith(".redislabs.com") ||
          url.hostname.endsWith(".redis-cloud.com") ||
          url.hostname.endsWith(".db.redis.io"))
    )
      throw new Error("TARGET_GUARD");
    const redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 6000,
      commandTimeout: 5000,
      retryStrategy: () => null,
      ...(url.protocol === "rediss:"
        ? { tls: { rejectUnauthorized: true, servername: url.hostname } }
        : {}),
    });
    redis.on("error", () => {});
    try {
      await redis.connect();
      const queues = {};
      for (const queue of ["fixture-changes", "content-generation"]) {
        let total = 0;
        for (const state of ["wait", "active", "paused"])
          total += await redis.llen(`${prefix}:${queue}:${state}`);
        for (const state of [
          "delayed",
          "prioritized",
          "waiting-children",
          "failed",
        ])
          total += await redis.zcard(`${prefix}:${queue}:${state}`);
        queues[queue] = total;
      }
      const workers = await redis.exists(
        ...[
          "football-ingestion",
          "outbox-dispatcher",
          "event-processor",
          "content-generator",
        ].map((name) => `health:worker:${name}`),
      );
      const lock = await redis.exists("lock:football-ingestion:live");
      const ready =
        Object.values(queues).every((count) => count === 0) &&
        workers === 0 &&
        lock === 0;
      safe &&= ready;
      console.log(
        JSON.stringify({
          service: label,
          tls: url.protocol === "rediss:",
          queues,
          worker_signals: workers,
          ingestion_lock: lock,
          ready_for_cutover: ready,
        }),
      );
    } finally {
      redis.disconnect();
    }
  }
  console.log(JSON.stringify({ read_only: true, safe_to_switch: safe }));
  if (!safe) process.exitCode = 1;
} catch {
  console.log("CUTOVER_CHECK_FAILED: details redacted");
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
