import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestResources } from "../support/resources.js";
import { schemaIdentifier } from "../support/isolation.js";
import {
  persistNormalizedFixture,
  createCanonicalEvent,
  processContentDelivery,
  approveContent,
  listDraftContent,
  FeedRepository,
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
  it("rejects stale review fingerprints and rolls back if audit recording fails", async () => {
    const { prisma } = resources;
    const item = await generate(20);
    const original = (await listDraftContent(prisma))[0]!;
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
    const current = (await listDraftContent(prisma))[0]!;
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
