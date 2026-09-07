import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { createQueues, redisKey } from "@fcp/shared";
import { persistNormalizedFixture } from "@fcp/database";
import type { NormalizedFixture } from "@fcp/football-core";
import { createTestResources } from "../support/resources.js";
import { schemaIdentifier } from "../support/isolation.js";

const suite =
  process.env.RUN_WORKER_TESTS === "true" ? describe : describe.skip;
const root = new URL("../../", import.meta.url);
type RunningChild = {
  process: ChildProcess;
  closed: Promise<void>;
  expectedExit: boolean;
  failed: boolean;
  role: string;
};
suite(
  "compiled worker process crash recovery through real BullMQ/Redis",
  () => {
    let resources: Awaited<ReturnType<typeof createTestResources>>;
    let redis: Redis | undefined;
    let queues: ReturnType<typeof createQueues> | undefined;
    const children: RunningChild[] = [];
    let releaseLock: (() => void) | undefined;
    let lockTransaction: Promise<void> | undefined;

    async function waitFor(
      label: string,
      check: () => Promise<boolean>,
      timeout = 30_000,
    ) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const dead = children.find(
          (child) =>
            !child.expectedExit &&
            (child.failed ||
              child.process.exitCode !== null ||
              child.process.signalCode !== null),
        );
        if (dead)
          throw new Error(
            `${dead.role} exited unexpectedly; build the workspace before worker tests`,
          );
        if (await check()) return;
        await delay(200);
      }
      throw new Error(`Timed out waiting for ${label}`);
    }

    function start(
      role: "outbox-dispatcher" | "event-processor" | "content-generator",
    ) {
      const database = new URL(resources.databaseUrl);
      database.searchParams.set("schema", resources.namespace);
      database.searchParams.set(
        "application_name",
        `${resources.namespace}-${role}`,
      );
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL(`workers/${role}/dist/index.js`, root))],
        {
          cwd: fileURLToPath(root),
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            NODE_ENV: "test",
            LOG_LEVEL: "silent",
            DATABASE_URL: database.toString(),
            REDIS_URL: resources.redisUrl,
            QUEUE_PREFIX: resources.namespace,
            OUTBOX_POLL_INTERVAL_MS: "500",
            WORKER_HEARTBEAT_TTL_SECONDS: "10",
            API_FOOTBALL_BASE_URL: "https://example.invalid",
            API_FOOTBALL_KEY: "test-not-used",
            CURSOR_SIGNING_SECRET:
              "worker-test-secret-never-used-for-partner-traffic",
          },
        },
      );
      // Never echo child environment/connection details from a failed test.
      child.stdout?.resume();
      child.stderr?.resume();
      const entry: RunningChild = {
        process: child,
        expectedExit: false,
        failed: false,
        role,
        closed: new Promise<void>((resolve) =>
          child.once("close", () => resolve()),
        ),
      };
      child.on("error", () => {
        entry.failed = true;
      });
      children.push(entry);
      return entry;
    }

    async function kill(child: RunningChild) {
      child.expectedExit = true;
      if (child.process.exitCode === null && child.process.signalCode === null)
        child.process.kill("SIGKILL");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          child.closed,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Test-owned child did not exit")),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }

    beforeAll(async () => {
      // Validates explicit loopback test endpoints before creating any client/child.
      resources = await createTestResources(process.env);
      schemaIdentifier(resources.namespace); // Also validates the owned queue prefix.
      redis = new Redis(resources.redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        commandTimeout: 5000,
      });
      redis.on("error", () => undefined);
      queues = createQueues(redis, resources.namespace);
      queues.fixtureChanges.on("error", () => undefined);
      queues.contentGeneration.on("error", () => undefined);
      await redis.ping();
    }, 90_000);

    afterAll(async () => {
      releaseLock?.();
      const failures: unknown[] = [];
      for (const child of children) {
        try {
          await kill(child);
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await lockTransaction;
      } catch (error) {
        failures.push(error);
      }
      if (resources !== undefined && queues !== undefined) {
        schemaIdentifier(resources.namespace);
        for (const queue of [queues.fixtureChanges, queues.contentGeneration]) {
          try {
            if (queue.opts.prefix !== resources.namespace)
              throw new Error("Refusing to clean a non-owned queue");
            // BullMQ removes only these two freshly namespaced, test-owned queues.
            await queue.obliterate({ force: true });
          } catch (error) {
            failures.push(error);
          }
          try {
            await queue.close();
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          await redis?.del(
            ...[
              "outbox-dispatcher",
              "event-processor",
              "content-generator",
            ].map((role) =>
              redisKey(`health:worker:${role}`, resources.namespace),
            ),
          );
        } catch (error) {
          failures.push(error);
        }
      }
      redis?.disconnect();
      try {
        await resources?.cleanup();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length)
        throw new AggregateError(failures, "Worker-test cleanup failed");
    }, 60_000);

    it("refreshes idle consumer heartbeats and expires them after process death", async () => {
      const idle = [start("event-processor"), start("content-generator")];
      const keys = idle.map((child) =>
        redisKey(`health:worker:${child.role}`, resources.namespace),
      );
      await waitFor("idle consumer startup", async () =>
        (await redis!.mget(...keys)).every((value) => value !== null),
      );
      const initial = await redis!.mget(...keys);
      await waitFor("idle consumer refresh", async () =>
        (await redis!.mget(...keys)).every(
          (value, index) => value !== null && value !== initial[index],
        ),
      );
      for (const child of idle) await kill(child);
      await waitFor("dead consumer expiry", async () =>
        (await redis!.mget(...keys)).every((value) => value === null),
      );
    }, 60_000);

    it("recovers a killed content worker without losing or duplicating committed publication", async () => {
      const { prisma, namespace } = resources;
      const fixture: NormalizedFixture = {
        id: "source",
        source: "api-football",
        sourceFixtureId: "9030",
        competition: {
          id: "c",
          source: "api-football",
          sourceId: "39",
          name: "Test",
          slug: "test",
          season: 2026,
        },
        homeTeam: {
          id: "h",
          source: "api-football",
          sourceId: "1",
          name: "Home",
        },
        awayTeam: {
          id: "a",
          source: "api-football",
          sourceId: "2",
          name: "Away",
        },
        status: "scheduled",
        score: { home: 0, away: 0 },
        kickoffAt: new Date("2026-09-09T12:00:00Z"),
        receivedAt: new Date("2026-09-09T11:59:00Z"),
      };
      await persistNormalizedFixture(prisma, fixture, []);
      await persistNormalizedFixture(
        prisma,
        {
          ...fixture,
          status: "first_half",
          minute: 1,
          score: { home: 1, away: 0 },
          receivedAt: new Date("2026-09-09T12:01:00Z"),
        },
        [
          {
            source: "api-football",
            sourceFixtureId: "9030",
            sourceEventId: "api-football:v2:9030:1:none:1:123:goal",
            sourceTeamId: "1",
            sourcePlayerId: "123",
            playerName: "Player",
            eventType: "goal",
            minute: 1,
          },
        ],
      );
      start("outbox-dispatcher");
      start("event-processor");
      await waitFor(
        "canonical events from the independent event worker",
        async () => (await prisma.footballEvent.count()) === 3,
      );
      await waitFor(
        "durable content handoffs",
        async () =>
          (await prisma.workOutbox.count({
            where: { kind: "content_generation" },
          })) === 3,
      );

      let locked!: () => void;
      const lockReady = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      lockTransaction = prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `LOCK TABLE ${schemaIdentifier(namespace)}.content_items IN SHARE MODE`,
          );
          locked();
          await release;
        },
        { timeout: 45_000 },
      );
      // Observe lock errors immediately; retain the original promise for cleanup.
      await Promise.race([lockReady, lockTransaction]);
      const doomed = start("content-generator");
      try {
        await waitFor(
          "content worker blocked inside its publication transaction",
          async () => {
            const rows = await prisma.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE application_name = ${`${namespace}-content-generator`} AND wait_event_type = 'Lock' AND query LIKE '%content_items%'`;
            return (rows[0]?.count ?? 0n) > 0n;
          },
        );
        await kill(doomed);
      } finally {
        releaseLock?.();
      }
      await lockTransaction;
      expect(await prisma.contentItem.count()).toBe(0);
      expect(
        await prisma.workOutbox.count({
          where: { kind: "content_generation", completedAt: null },
        }),
      ).toBe(3);
      start("content-generator");
      // Use actual BullMQ lock expiry/stall recovery; no production failpoints or fake acknowledgements.
      await waitFor(
        "replacement worker publication after lock expiry",
        async () => (await prisma.contentItem.count()) === 3,
        120_000,
      );
      await waitFor(
        "all outbox work to complete",
        async () =>
          (await prisma.workOutbox.count({ where: { completedAt: null } })) ===
          0,
      );
      expect(
        new Set(
          (await prisma.contentItem.findMany()).map((item) => item.eventId),
        ).size,
      ).toBe(3);
      expect(await queues!.contentGeneration.getFailedCount()).toBe(0);
    }, 180_000);
  },
);
