import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { parse } from "dotenv";
import { createPrisma } from "../packages/database/src/client.ts";
import { createProducerRedis } from "../packages/shared/src/redis.ts";
import { dashboardReader } from "../apps/admin/src/dashboard.ts";

let prisma;
let redis;
const deadline = setTimeout(() => {
  console.log("DASHBOARD_CHECK_TIMEOUT");
  process.exit(1);
}, 20000);
try {
  const env = parse(
    readFileSync(new URL("../.env.workers.local", import.meta.url)),
  );
  const uri = new URL(env.DATABASE_URL);
  if (
    decodeURIComponent(uri.username) !== "postgres.dsholtmeyivyjwiuzedb" ||
    !uri.hostname.endsWith(".supabase.com") ||
    !env.REDIS_URL.startsWith("rediss://")
  )
    throw new Error("TARGET_GUARD");
  for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"])
    uri.searchParams.delete(key);
  uri.searchParams.set("sslmode", "verify-full");
  uri.searchParams.set(
    "sslrootcert",
    "C:/Users/peterson/Downloads/prod-ca-2021.crt",
  );
  prisma = createPrisma(uri.toString(), { connectionTimeoutMillis: 5000 });
  redis = createProducerRedis(env.REDIS_URL);
  redis.on("error", () => {});
  await redis.connect();
  const result = await dashboardReader(
    prisma,
    redis,
    env.QUEUE_PREFIX ?? "bull",
  )();
  console.log(
    JSON.stringify({
      read_only: true,
      database: result.database,
      redis: result.redis,
      workers: result.workers,
      enabled_leagues: result.data?.competitions.length ?? null,
      latest_poll_status: result.data?.polls[0]?.status ?? null,
      stored_fixtures_in_view: result.data?.fixtures.length ?? null,
      content_in_view: result.data?.content.length ?? null,
      pending: result.data?.pending ?? null,
      provider_requests: 0,
    }),
  );
  if (result.database !== "connected" || result.redis !== "connected")
    process.exitCode = 1;
} catch {
  console.log("DASHBOARD_CHECK_FAILED: details redacted");
  process.exitCode = 1;
} finally {
  redis?.disconnect();
  await prisma?.$disconnect();
  clearTimeout(deadline);
}
