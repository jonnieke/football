import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redisKey, createQueues } from "@fcp/shared";
import { createTestResources } from "../support/resources.js";
import { sandboxEnvironment } from "../../scripts/sandbox-config.js";
import { schemaIdentifier } from "../support/isolation.js";

const pipeline = process.env.RUN_PIPELINE_TESTS === "true";

const suite =
  process.env.RUN_WORKER_TESTS === "true" ? describe : describe.skip;
suite(
  pipeline
    ? "four-worker end-to-end local pipeline"
    : "compiled collector against a loopback-only simulated provider",
  () => {
    let resources: Awaited<ReturnType<typeof createTestResources>>;
    let redis: Redis;
    let server: Server;
    let child: ChildProcess | undefined;
    let closed: Promise<void> | undefined;
    let childFailed = false;
    const downstream: Array<{ process: ChildProcess; closed: Promise<void> }> =
      [];
    let queues: ReturnType<typeof createQueues> | undefined;
    let origin = "";
    let phase: "live" | "finished" | "error" = "live";
    const requests: string[] = [];
    const unexpected: string[] = [];
    const now = new Date();
    const year = now.getUTCFullYear();
    const fixture = (league = 39) => ({
      fixture: {
        id: league === 39 ? 99001 : 99002,
        date: new Date(now.getTime() - 3_600_000).toISOString(),
        timestamp: Math.floor(now.getTime() / 1000) - 3600,
        status: {
          short: phase === "live" ? "1H" : "FT",
          long: "Test match",
          elapsed: phase === "live" ? 20 : 90,
        },
      },
      league: {
        id: league,
        name: "SIMULATED Premier League",
        country: "England",
        season: year,
      },
      teams: {
        home: { id: 1, name: "Test Home" },
        away: { id: 2, name: "Test Away" },
      },
      goals: { home: 1, away: 0 },
    });
    const health = (key: string) => redisKey(key, resources.namespace);
    async function waitFor(label: string, check: () => Promise<boolean>) {
      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline) {
        if (
          childFailed ||
          child?.exitCode !== null ||
          child?.signalCode !== null
        )
          throw new Error("Test collector exited unexpectedly");
        if (
          downstream.some(
            (entry) =>
              entry.process.exitCode !== null ||
              entry.process.signalCode !== null,
          )
        )
          throw new Error("Test downstream worker exited unexpectedly");
        if (await check()) return;
        await delay(200);
      }
      throw new Error(`Timed out: ${label}`);
    }

    beforeAll(async () => {
      resources = await createTestResources(process.env);
      redis = new Redis(resources.redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        commandTimeout: 5000,
        retryStrategy: () => null,
      });
      redis.on("error", () => undefined);
      await redis.ping();
      if (pipeline) {
        queues = createQueues(redis, resources.namespace);
        queues.fixtureChanges.on("error", () => undefined);
        queues.contentGeneration.on("error", () => undefined);
      }
      await resources.prisma.competition.create({
        data: {
          id: randomUUID(),
          source: "api-football",
          sourceId: "39",
          season: year,
          name: "SIMULATED Premier League",
          slug: "test-premier-league",
          enabled: true,
        },
      });
      server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        requests.push(url.pathname + url.search);
        response.setHeader("Content-Type", "application/json");
        if (
          requests.length > 80 ||
          request.method !== "GET" ||
          request.headers["x-apisports-key"] !== "test-only-no-real-key"
        ) {
          unexpected.push("request guard");
          response.writeHead(400);
          response.end("{}");
          return;
        }
        if (phase === "error") {
          response.end(
            JSON.stringify({
              errors: { requests: "SIMULATED quota failure" },
              response: [],
            }),
          );
          return;
        }
        if (
          url.pathname === "/fixtures/events" &&
          url.searchParams.get("fixture") === "99001"
        ) {
          response.end(
            JSON.stringify({
              errors: [],
              response: [
                {
                  time: { elapsed: 12, extra: null },
                  team: { id: 1, name: "Test Home" },
                  player: { id: 123, name: "Test Scorer" },
                  type: "Goal",
                  detail: "Normal Goal",
                },
              ],
            }),
          );
          return;
        }
        if (url.pathname === "/fixtures") {
          if (url.searchParams.get("live") === "all") {
            response.end(
              JSON.stringify({
                errors: [],
                response: phase === "live" ? [fixture(), fixture(140)] : [],
              }),
            );
            return;
          }
          if (url.searchParams.has("date")) {
            response.end(JSON.stringify({ errors: [], response: [] }));
            return;
          }
          if (url.searchParams.get("id") === "99001") {
            response.end(JSON.stringify({ errors: [], response: [fixture()] }));
            return;
          }
        }
        unexpected.push(url.pathname + url.search);
        response.writeHead(404);
        response.end("{}");
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No loopback provider port");
      origin = `http://127.0.0.1:${address.port}`;
    }, 90_000);

    afterAll(async () => {
      const failures: unknown[] = [];
      if (child && child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      if (closed) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            closed,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Collector did not exit")),
                10_000,
              );
            }),
          ]);
        } catch (error) {
          failures.push(error);
        } finally {
          clearTimeout(timer);
        }
      }
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      for (const entry of downstream) {
        if (
          entry.process.exitCode === null &&
          entry.process.signalCode === null
        )
          entry.process.kill("SIGKILL");
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            entry.closed,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Test worker did not exit")),
                10_000,
              );
            }),
          ]);
        } catch (error) {
          failures.push(error);
        } finally {
          clearTimeout(timer);
        }
      }
      if (queues) {
        schemaIdentifier(resources.namespace);
        for (const queue of [queues.fixtureChanges, queues.contentGeneration]) {
          try {
            if (queue.opts.prefix !== resources.namespace)
              throw new Error("Queue ownership mismatch");
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
      }
      if (redis) {
        try {
          await redis.del(
            ...[
              "lock:football-ingestion:live",
              "health:worker:football-ingestion",
              "health:provider:api-football",
              "health:worker:outbox-dispatcher",
              "health:worker:event-processor",
              "health:worker:content-generator",
            ].map(health),
          );
        } catch (error) {
          failures.push(error);
        }
        redis.disconnect();
      }
      try {
        await resources?.cleanup();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length)
        throw new AggregateError(failures, "Collector-test cleanup failed");
    }, 60_000);

    it("filters competitions, reconciles disappearance, deduplicates polls and recovers from provider errors", async () => {
      const database = new URL(resources.databaseUrl);
      database.searchParams.set("schema", resources.namespace);
      const env = {
        ...sandboxEnvironment(process.env),
        DATABASE_URL: database.toString(),
        REDIS_URL: resources.redisUrl,
        QUEUE_PREFIX: resources.namespace,
        LOG_LEVEL: "silent",
        API_FOOTBALL_BASE_URL: origin,
        API_FOOTBALL_KEY: "test-only-no-real-key",
        API_FOOTBALL_MAX_RETRIES: "0",
        API_FOOTBALL_TIMEOUT_MS: "1000",
        LIVE_POLL_INTERVAL_SECONDS: "5",
        SCHEDULE_POLL_INTERVAL_SECONDS: "86400",
        CURSOR_SIGNING_SECRET: "test-only-secret-not-used-by-live-partners",
        OUTBOX_POLL_INTERVAL_MS: "500",
      };
      if (pipeline) {
        for (const role of [
          "outbox-dispatcher",
          "event-processor",
          "content-generator",
        ]) {
          const processChild = spawn(
            process.execPath,
            [
              fileURLToPath(
                new URL(`../../workers/${role}/dist/index.js`, import.meta.url),
              ),
            ],
            {
              env,
              cwd: fileURLToPath(new URL("../../", import.meta.url)),
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            },
          );
          processChild.stdout?.resume();
          processChild.stderr?.resume();
          const entry = {
            process: processChild,
            closed: new Promise<void>((resolve) =>
              processChild.once("close", () => resolve()),
            ),
          };
          processChild.on("error", () => {
            childFailed = true;
          });
          downstream.push(entry);
        }
      }
      child = spawn(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../../workers/football-ingestion/dist/index.js",
              import.meta.url,
            ),
          ),
        ],
        {
          env,
          cwd: fileURLToPath(new URL("../../", import.meta.url)),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      child.stdout?.resume();
      child.stderr?.resume();
      closed = new Promise((resolve) => child!.once("close", () => resolve()));
      child.on("error", () => {
        childFailed = true;
      });
      const { prisma } = resources;
      const successes = () =>
        prisma.pollingRun.count({ where: { status: "succeeded" } });
      await waitFor("first poll", async () => (await successes()) >= 1);
      expect(await prisma.fixture.count()).toBe(1);
      expect((await prisma.fixture.findFirstOrThrow()).sourceFixtureId).toBe(
        "99001",
      );
      expect(requests.filter((path) => path.includes("date=")).length).toBe(3);
      const firstState = await prisma.fixtureState.findFirstOrThrow();
      expect(firstState.sourceEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            playerName: "Test Scorer",
            eventType: "goal",
          }),
        ]),
      );
      const workCount = await prisma.workOutbox.count();
      if (pipeline)
        await waitFor(
          "initial generated alerts",
          async () =>
            (await prisma.contentItem.count()) === 2 &&
            (await prisma.workOutbox.count({
              where: { completedAt: null },
            })) === 0,
        );
      const stableWorkCount = pipeline
        ? await prisma.workOutbox.count()
        : workCount;
      const initialSuccesses = await successes();
      await waitFor(
        "unchanged repeat poll",
        async () => (await successes()) > initialSuccesses,
      );
      expect(await prisma.fixtureState.count()).toBe(1);
      expect(await prisma.workOutbox.count()).toBe(stableWorkCount);
      phase = "finished";
      await waitFor(
        "finished reconciliation",
        async () =>
          (await prisma.fixture.findFirstOrThrow()).status === "finished",
      );
      expect(requests).toContain("/fixtures?id=99001");
      await waitFor(
        "poll lock released",
        async () =>
          (await redis.get(health("lock:football-ingestion:live"))) === null,
      );
      const states = await prisma.fixtureState.count();
      phase = "error";
      await waitFor(
        "failed poll recorded",
        async () =>
          (await prisma.pollingRun.count({ where: { status: "failed" } })) >= 1,
      );
      await waitFor(
        "unhealthy provider signal",
        async () =>
          (await redis.get(health("health:provider:api-football"))) ===
          "unhealthy",
      );
      expect(await prisma.fixtureState.count()).toBe(states);
      expect((await prisma.fixture.findFirstOrThrow()).status).toBe("finished");
      await waitFor(
        "error releases lease",
        async () =>
          (await redis.get(health("lock:football-ingestion:live"))) === null,
      );
      const beforeRecovery = await successes();
      phase = "finished";
      await waitFor(
        "provider recovery",
        async () => (await successes()) > beforeRecovery,
      );
      await waitFor(
        "healthy signal",
        async () =>
          (await redis.get(health("health:provider:api-football"))) ===
          "healthy",
      );
      expect(
        await redis.get(health("health:worker:football-ingestion")),
      ).not.toBeNull();
      expect(await prisma.fixtureState.count()).toBe(states);
      if (pipeline) {
        await waitFor(
          "full pipeline completion",
          async () =>
            (await prisma.contentItem.count()) === 3 &&
            (await prisma.workOutbox.count({
              where: { completedAt: null },
            })) === 0,
        );
        const content = await prisma.contentItem.findMany({
          include: { event: true },
        });
        expect(content.map((item) => item.event.eventType).sort()).toEqual([
          "goal",
          "match_finished",
          "match_started",
        ]);
        expect(new Set(content.map((item) => item.eventId)).size).toBe(3);
        expect(
          content.every(
            (item) =>
              item.status === "draft" &&
              item.publicationSequence === null &&
              item.publishedAt === null,
          ),
        ).toBe(true);
        expect(
          content.find((item) => item.event.eventType === "match_finished")
            ?.standardText,
        ).toContain("Test Home 1-0 Test Away");
        expect(
          content.find((item) => item.event.eventType === "goal")?.standardText,
        ).toContain("Test Scorer");
        expect(await queues!.fixtureChanges.getFailedCount()).toBe(0);
        expect(await queues!.contentGeneration.getFailedCount()).toBe(0);
        await waitFor("all four health signals", async () =>
          (
            await redis.mget(
              ...[
                "football-ingestion",
                "outbox-dispatcher",
                "event-processor",
                "content-generator",
              ].map((role) => health(`health:worker:${role}`)),
            )
          ).every((value) => value !== null),
        );
        const polls = await successes();
        await waitFor(
          "post-completion repeat poll",
          async () => (await successes()) > polls,
        );
        expect(await prisma.contentItem.count()).toBe(3);
        expect(await prisma.footballEvent.count()).toBe(3);
        expect(
          await prisma.workOutbox.count({ where: { completedAt: null } }),
        ).toBe(0);
      }
      expect(unexpected).toEqual([]);
      expect(requests.length).toBeLessThanOrEqual(80);
    }, 150_000);
  },
);
