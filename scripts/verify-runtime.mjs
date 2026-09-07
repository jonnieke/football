import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

// No database, Redis, upstream requests, or inherited credentials are used.
const root = new URL("../", import.meta.url);
const database = await import(new URL("packages/database/dist/index.js", root));
const material = await database.createApiKeyMaterial();
assert.equal(
  await database.verifyApiKeyHash(material.hash, material.plaintext),
  true,
);
console.log("PASS: compiled database module and native Argon2 hash/verify");

for (const service of [
  "apps/api",
  "workers/football-ingestion",
  "workers/event-processor",
  "workers/content-generator",
  "workers/outbox-dispatcher",
]) {
  const env = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "REDIS_URL",
    "API_FOOTBALL_KEY",
    "API_FOOTBALL_BASE_URL",
    "CURSOR_SIGNING_SECRET",
  ]) {
    delete env[key];
  }
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(`${service}/dist/index.js`, root))],
    {
      cwd: fileURLToPath(root),
      env,
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(
    result.status,
    1,
    `${service}: expected fail-fast configuration validation`,
  );
  assert.match(
    result.stderr,
    /Invalid environment configuration:/,
    `${service}: ${result.stderr}`,
  );
  assert.doesNotMatch(
    result.stderr,
    /Dynamic require|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION/,
  );
  console.log(
    `PASS: ${service} loads compiled dependencies and reaches configuration validation`,
  );
}
