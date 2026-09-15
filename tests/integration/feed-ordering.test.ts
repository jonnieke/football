import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { v7 as uuidv7 } from "uuid";
import {
  FeedRepository,
  createApiKeyMaterial,
  createCanonicalEvent,
  persistNormalizedFixture,
} from "@fcp/database";
import { parseCursor, createLogger, loadConfig } from "@fcp/shared";
import { buildApp } from "@fcp/api";
import { acquireStreamLease, bounded } from "../../apps/api/src/feed-stream.js";
import type { NormalizedFixture } from "@fcp/football-core";
import { createTestResources } from "../support/resources.js";

const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const secret = "test-secret-for-feed-publication-order";
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
suite("PostgreSQL commit-ordered feed and cursor recovery", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  let fixtureId: string;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
    const fixture: NormalizedFixture = {
      id: "source",
      source: "synthetic",
      sourceFixtureId: "9040",
      competition: {
        id: "c",
        source: "synthetic",
        sourceId: "39",
        season: 2026,
        name: "Test",
        slug: "test",
      },
      homeTeam: { id: "h", source: "synthetic", sourceId: "1", name: "Home" },
      awayTeam: { id: "a", source: "synthetic", sourceId: "2", name: "Away" },
      status: "scheduled",
      score: { home: 0, away: 0 },
      kickoffAt: new Date(),
      receivedAt: new Date(),
    };
    fixtureId = (await persistNormalizedFixture(resources.prisma, fixture))
      .fixtureId;
  }, 90_000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30_000);

  async function contentData(label: string) {
    const event = await createCanonicalEvent(resources.prisma, {
      fixtureId,
      eventType: "goal",
      sourceEventId: label,
    });
    return {
      id: uuidv7(),
      eventId: event.id,
      channel: "test",
      contentType: "live_alert",
      priority: "normal",
      shortText: label,
      standardText: label,
      status: "published",
      publishedAt: new Date(),
    };
  }

  it("atomically limits concurrent streams and releases a single lease", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        acquireStreamLease(resources.redis, "lease-test", "test"),
      ),
    );
    const accepted = attempts.filter((result) => result.status === "fulfilled");
    expect(accepted).toHaveLength(3);
    expect(
      attempts.filter((result) => result.status === "rejected"),
    ).toHaveLength(3);
    await accepted[0]!.value();
    const replacement = await acquireStreamLease(
      resources.redis,
      "lease-test",
      "test",
    );
    await Promise.all([
      replacement(),
      ...accepted.slice(1).map((result) => result.value()),
    ]);
  });

  it("streams a new publication over HTTP and replays missed reports on reconnect", async () => {
    const material = await createApiKeyMaterial();
    const client = await resources.prisma.apiClient.create({
      data: {
        id: uuidv7(),
        name: "Stream test",
        slug: "stream-test",
        keyPrefix: material.prefix,
        keyHash: material.hash,
        rateLimit: 1000,
      },
    });
    const app = await buildApp({
      config: loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: resources.databaseUrl,
        REDIS_URL: resources.redisUrl,
        API_FOOTBALL_BASE_URL: "https://example.invalid",
        API_FOOTBALL_KEY: "unused",
        CURSOR_SIGNING_SECRET: secret,
      }),
      prisma: resources.prisma,
      redis: resources.redis,
      logger: createLogger("silent"),
    });
    const controllers: AbortController[] = [];
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      const headers = { authorization: `Bearer ${material.plaintext}` };
      expect((await fetch(`${origin}/v1/feed/stream`)).status).toBe(401);
      expect(
        (await fetch(`${origin}/v1/feed/stream?after=invalid`, { headers }))
          .status,
      ).toBe(400);
      expect(
        (await fetch(`${origin}/v1/feed/stream?token=not-allowed`, { headers }))
          .status,
      ).toBe(400);
      async function connect(after?: string) {
        const controller = new AbortController();
        controllers.push(controller);
        const response = await fetch(`${origin}/v1/feed/stream?channel=test`, {
          headers: { ...headers, ...(after ? { "Last-Event-ID": after } : {}) },
          signal: controller.signal,
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "text/event-stream",
        );
        expect(response.headers.get("cache-control")).toContain("no-store");
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        return {
          controller,
          async event(name: string) {
            while (true) {
              const end = pending.indexOf("\n\n");
              if (end >= 0) {
                const frame = pending.slice(0, end);
                pending = pending.slice(end + 2);
                if (frame.includes(`event: ${name}\n`)) return frame;
                continue;
              }
              const chunk = await bounded(reader.read(), 10000);
              if (chunk.done) throw new Error(`Stream ended before ${name}`);
              pending += decoder.decode(chunk.value as Uint8Array, {
                stream: true,
              });
            }
          },
        };
      }
      const first = await connect();
      const ready = await first.event("ready");
      const start = /^id: (.+)$/m.exec(ready)![1]!;
      const data = await contentData("stream-one");
      const published = await resources.prisma.contentItem.create({ data });
      const live = await first.event("feed");
      expect(live).toContain(published.id);
      const cursor = /^id: (.+)$/m.exec(live)![1]!;
      expect(cursor).not.toBe(start);
      first.controller.abort();
      const missed = await resources.prisma.contentItem.create({
        data: await contentData("stream-missed"),
      });
      const resumed = await connect(cursor);
      await resumed.event("ready");
      const replay = await resumed.event("feed");
      expect(replay).toContain(missed.id);
      expect(replay).not.toContain(published.id);
      await resources.prisma.apiClient.update({
        where: { id: client.id },
        data: { revokedAt: new Date() },
      });
      expect(await resumed.event("access_revoked")).toContain("UNAUTHORIZED");
    } finally {
      for (const controller of controllers) controller.abort();
      app.server.closeAllConnections();
      await app.close();
    }
  }, 30_000);

  it("does not skip a slow transaction whose publication timestamp is earlier", async () => {
    const { prisma } = resources;
    const feed = new FeedRepository(prisma, secret);
    const tip = await feed.currentCursor();
    const empty = await feed.getFeed({ limit: 10, after: tip });
    expect(empty.items).toEqual([]);
    expect(empty.nextCursor).toBe(tip);
    const first = {
      ...(await contentData("slow")),
      publishedAt: new Date("2020-01-01T00:00:00Z"),
    };
    const second = {
      ...(await contentData("fast")),
      publishedAt: new Date("2030-01-01T00:00:00Z"),
    };
    const started = latch();
    const release = latch();
    const slow = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        started.release();
        await release.promise;
        return tx.contentItem.create({ data: first });
      },
      { timeout: 20_000 },
    );
    // Handle errors while the held transaction is still in flight.
    const settled = slow.then(
      (item) => ({ item }),
      (error: unknown) => ({ error }),
    );
    try {
      await Promise.race([started.promise, settled]);
      const fast = await prisma.contentItem.create({ data: second });
      const page = await feed.getFeed({ limit: 1, after: empty.nextCursor });
      expect(page.items).toEqual([expect.objectContaining({ id: fast.id })]);
      release.release();
      const outcome = await settled;
      if ("error" in outcome) throw outcome.error;
      const resumed = await feed.getFeed({ limit: 10, after: page.nextCursor });
      expect(resumed.items).toEqual([
        expect.objectContaining({ id: outcome.item.id }),
      ]);
      expect(
        outcome.item.publicationSequence! > fast.publicationSequence!,
      ).toBe(true);
      const noChange = await feed.getFeed({
        limit: 10,
        after: resumed.nextCursor,
      });
      expect(noChange.items).toEqual([]);
      expect(noChange.nextCursor).toBe(resumed.nextCursor);
    } finally {
      release.release();
      await settled;
    }
  });

  it.each([true, false])(
    "blocks a later reservation until the earlier transaction commits=%s",
    async (commit) => {
      const { prisma, namespace } = resources;
      const feed = new FeedRepository(prisma, secret);
      const baseline = await feed.getFeed({ limit: 500 });
      const highWater = BigInt(
        parseCursor(baseline.nextCursor, secret).sequence,
      );
      const a = await contentData(`writer-a-${commit}`);
      const b = await contentData(`writer-b-${commit}`);
      const inserted = latch();
      const release = latch();
      const first = prisma.$transaction(
        async (tx) => {
          await tx.contentItem.create({ data: a });
          inserted.release();
          await release.promise;
          if (!commit) throw new Error("expected rollback");
        },
        { timeout: 20_000 },
      );
      const firstResult = first.then(
        () => null,
        (error: unknown) => error,
      );
      let second: Promise<unknown> | undefined;
      let secondResult: Promise<unknown> | undefined;
      try {
        await Promise.race([inserted.promise, firstResult]);
        let completed = false;
        second = prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT set_config('application_name', ${`${namespace}-writer-b`}, true)`;
            return tx.contentItem.create({ data: b });
          },
          { timeout: 20_000 },
        );
        secondResult = second.then(
          () => {
            completed = true;
            return null;
          },
          (error: unknown) => error,
        );
        let blocked = false;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const rows = await prisma.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE application_name = ${`${namespace}-writer-b`} AND wait_event_type = 'Lock'`;
          if ((rows[0]?.count ?? 0n) > 0n) {
            blocked = true;
            break;
          }
          await delay(50);
        }
        expect(blocked).toBe(true);
        expect(completed).toBe(false);
        const during = await feed.getFeed({
          limit: 500,
          after: baseline.nextCursor,
        });
        expect(during.items).toEqual([]);
        expect(during.nextCursor).toBe(baseline.nextCursor);
        release.release();
        const failure = await firstResult;
        if (commit && failure !== null)
          throw new Error("First publisher failed", { cause: failure });
        if (!commit)
          expect(failure).toMatchObject({ message: "expected rollback" });
        const secondFailure = await secondResult;
        if (secondFailure !== null)
          throw new Error("Second publisher failed", { cause: secondFailure });
        const record = await prisma.contentItem.findUniqueOrThrow({
          where: { id: b.id },
        });
        expect(record.publicationSequence).toBe(highWater + (commit ? 2n : 1n));
        const after = await feed.getFeed({
          limit: 500,
          after: baseline.nextCursor,
        });
        expect(after.items).toHaveLength(commit ? 2 : 1);
      } finally {
        release.release();
        await firstResult;
        await secondResult;
      }
    },
  );

  it("freezes published payload/filter identity and rejects arbitrary publication metadata", async () => {
    const { prisma } = resources;
    const data = await contentData("immutable");
    const item = await prisma.contentItem.create({ data });
    for (const update of [
      { channel: "changed" },
      { status: "withdrawn" },
      { shortText: "changed" },
      { publicationSequence: 9000n },
    ]) {
      await expect(
        prisma.contentItem.update({ where: { id: item.id }, data: update }),
      ).rejects.toThrow();
    }
    await expect(
      prisma.contentItem.delete({ where: { id: item.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.contentItem.create({
        data: { ...(await contentData("forged")), publicationSequence: 9999n },
      }),
    ).rejects.toThrow();
    // Routing uses the publication's immutable event-type snapshot, not a mutable join.
    await prisma.footballEvent.update({
      where: { id: data.eventId },
      data: { eventType: "red_card" },
    });
    expect(
      (await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } }))
        .eventType,
    ).toBe("goal");
    const feed = new FeedRepository(prisma, secret);
    expect(
      (await feed.getFeed({ limit: 500, eventType: "red_card" })).items,
    ).toEqual([]);
  });

  it("advances empty filtered polls and requires reset after epoch rotation", async () => {
    const { prisma } = resources;
    const feed = new FeedRepository(prisma, secret);
    const page = await feed.getFeed({ limit: 10, channel: "new-channel" });
    expect(page.items).toEqual([]);
    const item = await prisma.contentItem.create({
      data: { ...(await contentData("new-channel")), channel: "new-channel" },
    });
    expect(
      (
        await feed.getFeed({
          limit: 10,
          channel: "new-channel",
          after: page.nextCursor,
        })
      ).items,
    ).toEqual([expect.objectContaining({ id: item.id })]);
    await prisma.feedPublicationState.update({
      where: { id: 1 },
      data: { epoch: uuidv7() },
    });
    await expect(
      feed.getFeed({
        limit: 10,
        channel: "new-channel",
        after: page.nextCursor,
      }),
    ).rejects.toMatchObject({ code: "CURSOR_RESET_REQUIRED", statusCode: 409 });
  });
});
