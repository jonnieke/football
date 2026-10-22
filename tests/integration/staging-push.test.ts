import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCanonicalEvent,
  persistNormalizedFixture,
  processContentDelivery,
} from "@fcp/database";
import { createTestResources } from "../support/resources.js";

const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;

suite("durable staging-table push delivery", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  let fixtureId: string;

  beforeAll(async () => {
    resources = await createTestResources(process.env);
    const fixture = await persistNormalizedFixture(resources.prisma, {
      id: "fixture",
      source: "api-football",
      sourceFixtureId: "staging-push-test",
      competition: {
        id: "competition",
        source: "api-football",
        sourceId: "39",
        season: 2026,
        name: "Test league",
        slug: "staging-push-test",
      },
      homeTeam: {
        id: "home",
        source: "api-football",
        sourceId: "staging-home",
        name: "Arsenal",
      },
      awayTeam: {
        id: "away",
        source: "api-football",
        sourceId: "staging-away",
        name: "Chelsea",
      },
      status: "second_half",
      score: { home: 1, away: 1 },
      kickoffAt: new Date(),
      receivedAt: new Date(),
    });
    fixtureId = fixture.fixtureId;
    await resources.prisma.competition.updateMany({ data: { enabled: true } });
  }, 90_000);

  afterAll(async () => {
    await resources?.cleanup();
  }, 30_000);

  it("keeps direct database delivery disconnected from new API publications", async () => {
    const event = await createCanonicalEvent(resources.prisma, {
      fixtureId,
      eventType: "goal",
      minute: 67,
      homeScore: 2,
      awayScore: 1,
      liveObservedAt: new Date(),
    });
    await Promise.all([
      processContentDelivery(resources.prisma, { eventId: event.id }, 150),
      processContentDelivery(resources.prisma, { eventId: event.id }, 150),
    ]);
    const jobs = await resources.prisma.stagingPushDelivery.findMany();
    expect(jobs).toHaveLength(0);
  });

  it("keeps the private delivery ledger behind RLS", async () => {
    const rows = await resources.prisma.$queryRaw<
      Array<{ relrowsecurity: boolean }>
    >`SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${resources.namespace} AND c.relname='staging_push_deliveries'`;
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });
});
