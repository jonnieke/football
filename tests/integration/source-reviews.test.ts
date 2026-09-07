import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  persistNormalizedFixture,
  prepareFixtureObservation,
  processFixtureDelivery,
  decideSourceReview,
  createCanonicalEvent,
} from "@fcp/database";
import type {
  NormalizedFixture,
  NormalizedSourceEvent,
} from "@fcp/football-core";
import { createTestResources } from "../support/resources.js";
import { schemaIdentifier } from "../support/isolation.js";

const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("durable source reviews and atomic decisions", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
  }, 90_000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30_000);
  it("holds revisions through replay, persists decisions, and rolls back a failed approval handoff", async () => {
    const { prisma } = resources;
    const fixture: NormalizedFixture = {
      id: "source",
      source: "api-football",
      sourceFixtureId: "9020",
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
      status: "first_half",
      score: { home: 1, away: 0 },
      minute: 20,
      kickoffAt: new Date("2026-09-09T12:00:00Z"),
      receivedAt: new Date("2026-09-09T12:20:00Z"),
    };
    const original: NormalizedSourceEvent = {
      source: "api-football",
      sourceFixtureId: "9020",
      sourceEventId: "api-football:v2:9020:10:none:1:123:goal",
      eventType: "goal",
      minute: 10,
      sourceTeamId: "1",
      sourcePlayerId: "123",
      playerName: "Original",
    };
    const first = await persistNormalizedFixture(prisma, fixture, [original]);
    async function drain() {
      const jobs = await prisma.workOutbox.findMany({
        where: { kind: "fixture_change", completedAt: null },
        orderBy: { id: "asc" },
      });
      for (const work of jobs)
        await processFixtureDelivery(
          prisma,
          {
            outboxId: work.id,
            fixtureId: first.fixtureId,
            previousStateId: first.currentStateId,
            currentStateId: first.currentStateId,
          },
          (payload) => prepareFixtureObservation(prisma, payload),
        );
    }
    await drain();
    const immutable = await prisma.footballEvent.findFirstOrThrow({
      where: { eventType: "goal" },
    });
    await persistNormalizedFixture(
      prisma,
      { ...fixture, receivedAt: new Date("2026-09-09T12:21:00Z") },
      [],
    );
    const revised = {
      ...original,
      sourceEventId: "api-football:v2:9020:11:none:1:456:goal",
      minute: 11,
      sourcePlayerId: "456",
      playerName: "Revised",
    };
    await persistNormalizedFixture(
      prisma,
      { ...fixture, receivedAt: new Date("2026-09-09T12:22:00Z") },
      [revised],
    );
    await drain();
    const review = await prisma.sourceEventReview.findFirstOrThrow();
    expect(review.reason).toBe("POSSIBLE_SOURCE_REVISION");
    expect(
      await prisma.footballEvent.count({ where: { eventType: "goal" } }),
    ).toBe(1);
    // Identical subsequent data, and manual canonical persistence, cannot bypass the hold.
    await persistNormalizedFixture(
      prisma,
      { ...fixture, minute: 21, receivedAt: new Date("2026-09-09T12:23:00Z") },
      [revised],
    );
    await expect(
      createCanonicalEvent(prisma, {
        fixtureId: first.fixtureId,
        eventType: "goal",
        sourceEventId: revised.sourceEventId,
      }),
    ).rejects.toThrow("held");
    const decision = {
      id: review.id,
      action: "publish-one" as const,
      actor: "integration-operator",
      reason: "Verified this is a distinct source event",
    };
    const schema = schemaIdentifier(resources.namespace);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${schema}.work_outbox ADD CONSTRAINT reject_review_handoff CHECK (kind <> 'content_generation') NOT VALID`,
    );
    await expect(decideSourceReview(prisma, decision)).rejects.toThrow();
    expect(
      (
        await prisma.sourceEventReview.findUniqueOrThrow({
          where: { id: review.id },
        })
      ).status,
    ).toBe("pending");
    expect(
      await prisma.footballEvent.count({ where: { eventType: "goal" } }),
    ).toBe(1);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${schema}.work_outbox DROP CONSTRAINT reject_review_handoff`,
    );
    const results = await Promise.all([
      decideSourceReview(prisma, decision),
      decideSourceReview(prisma, decision),
    ]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(
      await prisma.footballEvent.count({ where: { eventType: "goal" } }),
    ).toBe(2);
    const approved = await prisma.sourceEventReview.findUniqueOrThrow({
      where: { id: review.id },
    });
    expect(approved.decidedBy).toBe("integration-operator");
    expect(approved.eventId).not.toBeNull();
    expect(
      await prisma.workOutbox.count({
        where: { dedupeKey: `content-${approved.eventId}` },
      }),
    ).toBe(1);
    await expect(
      decideSourceReview(prisma, { ...decision, action: "dismiss" }),
    ).rejects.toThrow("conflicting");
    expect(
      await prisma.footballEvent.findUniqueOrThrow({
        where: { id: immutable.id },
      }),
    ).toEqual(immutable);
    const card = {
      ...original,
      sourceEventId: "api-football:v2:9020:22:none:1:123:red_card",
      eventType: "red_card" as const,
      minute: 22,
    };
    await persistNormalizedFixture(
      prisma,
      { ...fixture, receivedAt: new Date("2026-09-09T12:24:00Z") },
      [revised, card, card],
    );
    const duplicate = await prisma.sourceEventReview.findFirstOrThrow({
      where: { reason: "DUPLICATE_SOURCE_KEY" },
    });
    await decideSourceReview(prisma, {
      ...decision,
      id: duplicate.id,
      action: "dismiss",
      reason: "Provider duplicate, do not infer another event",
    });
    await drain();
    expect(
      await prisma.footballEvent.count({ where: { eventType: "red_card" } }),
    ).toBe(0);
    expect(
      (
        await prisma.sourceEventReview.findUniqueOrThrow({
          where: { id: duplicate.id },
        })
      ).status,
    ).toBe("dismissed");
    // Simulate an upgraded fixture with retained observations and no applied policy.
    await prisma.fixture.update({
      where: { id: first.fixtureId },
      data: { sourceReviewVersion: 0 },
    });
    await persistNormalizedFixture(
      prisma,
      { ...fixture, receivedAt: new Date("2026-09-09T12:25:00Z") },
      [revised, card, card],
    );
    expect(
      (
        await prisma.fixture.findUniqueOrThrow({
          where: { id: first.fixtureId },
        })
      ).sourceReviewVersion,
    ).toBe(1);
    expect(await prisma.sourceEventReview.count()).toBe(2);
    expect(
      (
        await prisma.sourceEventReview.findUniqueOrThrow({
          where: { id: duplicate.id },
        })
      ).status,
    ).toBe("dismissed");
  }, 60_000);
});
