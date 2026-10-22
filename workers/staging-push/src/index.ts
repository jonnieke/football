import { setTimeout as sleep } from "node:timers/promises";
import type { ResultSetHeader } from "mysql2";
import { createPrisma, deliverNextStagingPush } from "@fcp/database";
import {
  createStagingPool,
  mysqlStagingSender,
  stagingPushConfig,
} from "./sender.js";

let prisma: ReturnType<typeof createPrisma> | undefined;
let pool: ReturnType<typeof createStagingPool> | undefined;
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

try {
  const config = stagingPushConfig(process.env);
  prisma = createPrisma(process.env.DATABASE_URL ?? "", {
    connectionTimeoutMillis: 5000,
  });
  pool = createStagingPool(config);
  await pool.query("SELECT 1");
  const send = mysqlStagingSender((sql, values) =>
    pool!.execute<ResultSetHeader>(sql, [...values]),
  );
  while (!stopping) {
    try {
      const status = await deliverNextStagingPush(prisma, send);
      if (status !== "idle")
        console.log(JSON.stringify({ component: "staging-push", status }));
    } catch {
      console.error(
        JSON.stringify({
          component: "staging-push",
          code: "PROCESSING_FAILED",
        }),
      );
    }
    await sleep(config.STAGING_PUSH_POLL_INTERVAL_MS);
  }
} catch {
  console.error(
    "Staging push worker configuration or startup failed; delivery remains stopped.",
  );
  process.exitCode = 1;
} finally {
  try {
    await Promise.all([prisma?.$disconnect(), pool?.end()]);
  } catch {
    console.error("Staging push worker cleanup failed.");
    process.exitCode = 1;
  }
}
