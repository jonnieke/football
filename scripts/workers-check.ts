import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { loadConfig } from "../packages/shared/src/config.js";

// Offline only: do not import worker entry points or database/Redis clients.
const root = new URL("../", import.meta.url);
const file = new URL(".env.workers.local", root);
let ready = true;
function blocked(message: string): void {
  ready = false;
  console.log(`NOT READY: ${message}`);
}

console.log(
  "Local worker readiness check — no network calls or workers started.",
);
if (Number(process.versions.node.split(".")[0]) !== 24)
  blocked("Use Node.js 24 for the worker runtime.");

if (!existsSync(file)) {
  blocked("Create .env.workers.local using docs/LOCAL_WORKERS.md.");
} else {
  try {
    // Intentionally ignore shell variables: validate this file alone.
    const environment = parse(readFileSync(file));
    const required = [
      "DATABASE_URL",
      "REDIS_URL",
      "API_FOOTBALL_BASE_URL",
      "API_FOOTBALL_KEY",
      "CURSOR_SIGNING_SECRET",
    ];
    const missing = required.filter(
      (key) =>
        !environment[key]?.trim() ||
        /replace-me|YOUR-PASSWORD/i.test(environment[key] ?? ""),
    );
    if (missing.length > 0) {
      blocked(`Fill these settings privately: ${missing.join(", ")}.`);
    } else {
      let config;
      try {
        config = loadConfig(environment);
      } catch {
        blocked(
          "Settings failed validation; review the local file (values withheld).",
        );
      }
      if (config) {
        if (
          !/^(postgres|postgresql):$/.test(
            new URL(config.DATABASE_URL).protocol,
          )
        )
          blocked(
            "DATABASE_URL must be a PostgreSQL connection string, not a project API URL.",
          );
        if (!/^rediss?:$/.test(new URL(config.REDIS_URL).protocol))
          blocked(
            "REDIS_URL must be a Redis connection string, not an HTTPS REST endpoint.",
          );
        if (
          config.API_FOOTBALL_BASE_URL !== "https://v3.football.api-sports.io"
        )
          blocked(
            "Review API_FOOTBALL_BASE_URL before sending the provider key.",
          );
        if (new URL(config.REDIS_URL).protocol === "redis:")
          console.log(
            "REVIEW: Redis connection is not using TLS; check provider TLS support before live use.",
          );
      }
    }
  } catch {
    blocked(
      "Could not read the settings file (details withheld to protect secrets).",
    );
  }
}

for (const name of [
  "football-ingestion",
  "event-processor",
  "content-generator",
  "outbox-dispatcher",
]) {
  if (!existsSync(new URL(`workers/${name}/dist/index.js`, root)))
    blocked(
      `Build artifact missing for ${name}; build with Node.js 24 before testing.`,
    );
}
console.log(`Settings location: ${fileURLToPath(file)}`);
console.log(
  "Still required before starting: verify database migrations and enabled competitions, Redis capacity/eviction policy, queue namespace, and API-Football request allowance.",
);
console.log(
  "Using the same database and Redis as Vercel is a LIVE-data test, not an isolated sandbox. Workers can modify records and process existing jobs.",
);
console.log(
  ready
    ? "Offline checks passed. This is NOT permission to start workers or proof of connectivity."
    : "Preparation incomplete. No services were started.",
);
process.exitCode = ready ? 0 : 1;
