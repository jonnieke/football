import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestResources } from "../support/resources.js";
import { schemaIdentifier } from "../support/isolation.js";
import { v7 as uuidv7 } from "uuid";
import { liveFeedReader } from "../../apps/admin/src/live-feed.js";
import {
  persistNormalizedFixture,
  createCanonicalEvent,
  processContentDelivery,
  approveContent,
  listDraftContent,
  FeedRepository,
  prepareFixtureObservation,
  processFixtureDelivery,
} from "@fcp/database";

const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("draft-first content and atomic administrator approval", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  let fixtureId: string;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
    fixtureId = (
      await persistNormalizedFixture(resources.prisma, {
        id: "f",
        source: "api-football",
        sourceFixtureId: "9400",
        competition: {
          id: "c",
          source: "api-football",
          sourceId: "39",
          season: 2026,
          name: "Test",
          slug: "test",
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
        status: "finished",
        score: { home: 1, away: 0 },
        kickoffAt: new Date("2026-01-01T12:00:00Z"),
        receivedAt: new Date("2026-01-01T14:00:00Z"),
      })
    ).fixtureId;
  }, 90_000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30_000);
  const generate = async (minute: number) => {
    const event = await createCanonicalEvent(resources.prisma, {
      fixtureId,
      eventType: "goal",
      minute,
      playerName: "Player",
      homeScore: 1,
      awayScore: 0,
    });
    await processContentDelivery(resources.prisma, { eventId: event.id }, 160);
    return resources.prisma.contentItem.findFirstOrThrow({
      where: { eventId: event.id },
    });
  };
  it("keeps generated drafts out of the feed and publishes once under concurrent approval", async () => {
    const { prisma } = resources;
    const item = await generate(10);
    expect(item).toMatchObject({
      status: "draft",
      publishedAt: null,
      publicationSequence: null,
    });
    const feed = new FeedRepository(
      prisma,
      "test-cursor-secret-at-least-32-characters",
    );
    const empty = await feed.getFeed({ limit: 50 });
    expect(empty.items).toHaveLength(0);
    const draft = (await listDraftContent(prisma))[0]!;
    const results = await Promise.allSettled([
      approveContent(
        prisma,
        { id: draft.id, fingerprint: draft.fingerprint },
        "admin@example.com",
      ),
      approveContent(
        prisma,
        { id: draft.id, fingerprint: draft.fingerprint },
        "other@example.com",
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await prisma.contentApproval.count()).toBe(1);
    const resumed = await feed.getFeed({ limit: 50, after: empty.nextCursor });
    expect(resumed.items).toHaveLength(1);
    expect(await listDraftContent(prisma)).toHaveLength(0);
    await processContentDelivery(prisma, { eventId: item.eventId }, 160);
    expect(await prisma.contentItem.count()).toBe(1);
    expect(await prisma.contentApproval.count()).toBe(1);
    await expect(
      prisma.contentItem.update({
        where: { id: item.id },
        data: { standardText: "tampered" },
      }),
    ).rejects.toThrow();
  });
  it("automatically publishes a fresh observed goal once without an approval record", async () => {
    const { prisma } = resources;
    const readLive = liveFeedReader(prisma);
    const baseline = await readLive();
    const fixture = await prisma.fixture.findUniqueOrThrow({
      where: { id: fixtureId },
    });
    await prisma.competition.update({
      where: { id: fixture.competitionId },
      data: { enabled: true },
    });
    const now = new Date();
    const previous = await prisma.fixtureState.create({
      data: {
        id: uuidv7(),
        fixtureId,
        status: "first_half",
        minute: 22,
        homeScore: 0,
        awayScore: 0,
        rawHash: "live-before",
        sourceEvents: [],
        capturedAt: new Date(now.getTime() - 15000),
      },
    });
    const current = await prisma.fixtureState.create({
      data: {
        id: uuidv7(),
        fixtureId,
        status: "first_half",
        minute: 23,
        homeScore: 1,
        awayScore: 0,
        rawHash: "live-after",
        sourceEvents: [
          {
            source: "api-football",
            sourceFixtureId: "9400",
            sourceEventId: "api-football:v2:9400:23:none:1:10:goal",
            eventType: "goal",
            minute: 23,
            sourceTeamId: "1",
            sourcePlayerId: "10",
            playerName: "Live Player",
          },
        ],
        capturedAt: now,
      },
    });
    const payload = {
      fixtureId,
      previousStateId: previous.id,
      currentStateId: current.id,
    };
    await processFixtureDelivery(prisma, payload, (input) =>
      prepareFixtureObservation(prisma, input),
    );
    const event = await prisma.footballEvent.findFirstOrThrow({
      where: { fixtureId, playerName: "Live Player" },
    });
    const approvalsBefore = await prisma.contentApproval.count();
    await Promise.all([
      processContentDelivery(prisma, { eventId: event.id }, 160),
      processContentDelivery(prisma, { eventId: event.id }, 160),
    ]);
    const item = await prisma.contentItem.findFirstOrThrow({
      where: { eventId: event.id },
    });
    expect(item.status).toBe("published");
    const live = await readLive(baseline.cursor);
    expect(live.items.map((entry) => entry.id)).toContain(item.id);
    expect(live.items.find((entry) => entry.id === item.id)?.match).toBe(
      "Home v Away",
    );
    expect((await readLive(live.cursor)).items).toEqual([]);
    expect(item.publishedAt).not.toBeNull();
    expect(item.publicationSequence).not.toBeNull();
    expect(await prisma.contentApproval.count()).toBe(approvalsBefore);
    expect(
      await prisma.contentItem.count({ where: { eventId: event.id } }),
    ).toBe(1);
    const feed = await new FeedRepository(
      prisma,
      "test-cursor-secret-at-least-32-characters",
    ).getFeed({ limit: 50 });
    expect(feed.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: item.id })]),
    );
    const stale = await createCanonicalEvent(prisma, {
      fixtureId,
      eventType: "goal",
      minute: 70,
      liveObservedAt: new Date(now.getTime() - 180000),
    });
    await processContentDelivery(prisma, { eventId: stale.id }, 160);
    expect(
      (
        await prisma.contentItem.findFirstOrThrow({
          where: { eventId: stale.id },
        })
      ).status,
    ).toBe("draft");
    await prisma.competition.update({
      where: { id: fixture.competitionId },
      data: { enabled: false },
    });
    const disabled = await createCanonicalEvent(prisma, {
      fixtureId,
      eventType: "goal",
      minute: 71,
      liveObservedAt: new Date(),
    });
    await processContentDelivery(prisma, { eventId: disabled.id }, 160);
    expect(
      (
        await prisma.contentItem.findFirstOrThrow({
          where: { eventId: disabled.id },
        })
      ).status,
    ).toBe("draft");
  });
  it("starts with the latest 50, catches up without gaps and resets changed histories", async () => {
    const { prisma } = resources;
    const readLive = liveFeedReader(prisma);
    const baseline = await readLive();
    const event = await createCanonicalEvent(prisma, {
      fixtureId,
      eventType: "goal",
      minute: 300,
    });
    // Different channels model a publication burst without invoking any sender.
    for (let index = 0; index < 55; index++) {
      await prisma.contentItem.create({
        data: {
          id: uuidv7(),
          eventId: event.id,
          channel: `test-${index}`,
          contentType: "short",
          priority: "normal",
          shortText: `Test ${index}`,
          standardText: `Test ${index}`,
          status: "published",
          publishedAt: new Date(),
        },
      });
    }
    const latest = await readLive();
    expect(latest.items).toHaveLength(50);
    expect(latest.items[0]?.shortText).toBe("Test 5");
    const page1 = await readLive(baseline.cursor);
    expect(page1.items).toHaveLength(50);
    expect(page1.more).toBe(true);
    const page2 = await readLive(page1.cursor);
    expect(page2.items).toHaveLength(5);
    expect(page2.more).toBe(false);
    expect(
      new Set([...page1.items, ...page2.items].map((item) => item.id)).size,
    ).toBe(55);
    expect((await readLive(page2.cursor)).items).toEqual([]);
    const reset = await readLive(`${uuidv7()}:0`);
    expect(reset.reset).toBe(true);
    expect(reset.items).toHaveLength(50);
  });
  it("rejects stale review fingerprints and rolls back if audit recording fails", async () => {
    const { prisma } = resources;
    const item = await generate(20);
    const original = (await listDraftContent(prisma)).find(
      (draft) => draft.id === item.id,
    )!;
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { standardText: "Updated draft" },
    });
    await expect(
      approveContent(
        prisma,
        { id: item.id, fingerprint: original.fingerprint },
        "admin@example.com",
      ),
    ).rejects.toThrow("Content changed");
    const current = (await listDraftContent(prisma)).find(
      (draft) => draft.id === item.id,
    )!;
    const before = await prisma.feedPublicationState.findUniqueOrThrow({
      where: { id: 1 },
    });
    const schema = schemaIdentifier(resources.namespace);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${schema}.test_approval_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER test_approval_fail BEFORE INSERT ON ${schema}.content_approvals FOR EACH ROW EXECUTE FUNCTION ${schema}.test_approval_fail()`,
    );
    try {
      await expect(
        approveContent(
          prisma,
          { id: item.id, fingerprint: current.fingerprint },
          "admin@example.com",
        ),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER test_approval_fail ON ${schema}.content_approvals`,
      );
    }
    expect(
      await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({
      status: "draft",
      publishedAt: null,
      publicationSequence: null,
    });
    expect(
      await prisma.contentApproval.count({ where: { contentId: item.id } }),
    ).toBe(0);
    expect(
      (
        await prisma.feedPublicationState.findUniqueOrThrow({
          where: { id: 1 },
        })
      ).highWater,
    ).toBe(before.highWater);
  });
});
