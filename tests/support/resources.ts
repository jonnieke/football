import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createPrisma } from "@fcp/database";
import { Redis } from "ioredis";
import {
  IsolatedRedis,
  newTestNamespace,
  schemaIdentifier,
  testEndpoints,
} from "./isolation.js";

const execFileAsync = promisify(execFile);

export async function createTestResources(environment: NodeJS.ProcessEnv) {
  // Guards must run before client construction or any network side effect.
  const endpoints = testEndpoints(environment);
  const namespace = newTestNamespace();
  const schema = schemaIdentifier(namespace);
  const scopedUrl = new URL(endpoints.databaseUrl);
  scopedUrl.searchParams.set("schema", namespace);
  const prisma = createPrisma(endpoints.databaseUrl, {
    schema: namespace,
    connectionTimeoutMillis: 5000,
  });
  const client = new Redis(endpoints.redisUrl, {
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on("error", () => {
    /* Connection/command promises report failures to Vitest. */
  });
  const redis = new IsolatedRedis(client, namespace);
  let ownsSchema = false;
  let closed = false;

  async function cleanup(): Promise<void> {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    try {
      await redis.cleanup();
    } catch (error) {
      failures.push(error);
    }
    client.disconnect();
    try {
      // Ownership is granted only by successful CREATE, never by IF NOT EXISTS.
      if (ownsSchema)
        await prisma.$executeRawUnsafe(`DROP SCHEMA ${schema} CASCADE`);
    } catch (error) {
      failures.push(error);
    } finally {
      await prisma.$disconnect();
    }
    if (failures.length)
      throw new AggregateError(failures, "Isolated test cleanup failed");
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
    ownsSchema = true;
    await client.connect();
    const root = new URL("../../", import.meta.url);
    try {
      await execFileAsync(
        process.execPath,
        [
          fileURLToPath(new URL("node_modules/prisma/build/index.js", root)),
          "migrate",
          "deploy",
        ],
        {
          cwd: fileURLToPath(root),
          timeout: 60_000,
          env: { ...environment, DATABASE_URL: scopedUrl.toString() },
        },
      );
    } catch {
      // CLI errors may contain a connection URL; do not echo child output.
      throw new Error(
        "Isolated test migration failed; check test database access and migrations",
      );
    }
    return { prisma, redis, cleanup, namespace, ...endpoints };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Test setup and cleanup failed",
      );
    }
    throw error;
  }
}
