import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  persistNormalizedFixture,
  prepareFixtureObservation,
  processFixtureDelivery,
  processContentDelivery,
} from "@fcp/database";
import { fixtureChangeJobId } from "@fcp/shared";
import type {
  NormalizedFixture,
  NormalizedSourceEvent,
} from "@fcp/football-core";
import { fixtureWorkSchema } from "../../packages/database/src/outbox.js";
import { createTestResources } from "../support/resources.js";

const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("immutable quiet-poll continuity", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
  }, 90000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30000);
  const fixture = (id: string, time: number): NormalizedFixture => ({
    id,
    source: "api-football",
    sourceFixtureId: id,
    competition: {
      id: "c",
      source: "api-football",
      sourceId: "39",
      season: 2026,
      name: "Test",
      slug: "test",
    },
    homeTeam: { id: "h", source: "api-football", sourceId: "1", name: "Home" },
    awayTeam: { id: "a", source: "api-football", sourceId: "2", name: "Away" },
    status: "first_half",
    minute: 23,
    score: { home: 0, away: 0 },
    kickoffAt: new Date(time - 1380000),
    receivedAt: new Date(time),
  });
  const goal = (id: string): NormalizedSourceEvent => ({
    source: "api-football",
    sourceFixtureId: id,
    sourceEventId: `api-football:v2:${id}:23:none:1:123:goal`,
    sourceTeamId: "1",
    sourcePlayerId: "123",
    playerName: "Player",
    minute: 23,
    eventType: "goal",
  });
  async function work(
    result: Awaited<ReturnType<typeof persistNormalizedFixture>>,
  ) {
    return resources.prisma.workOutbox.findUniqueOrThrow({
      where: {
        dedupeKey: fixtureChangeJobId(result.fixtureId, result.currentStateId),
      },
    });
  }
  it("publishes a new goal after ten quiet minutes without extra snapshots or work", async () => {
    const { prisma } = resources;
    const now = Date.now();
    const initial = fixture("9020", now - 630000);
    const first = await persistNormalizedFixture(prisma, initial, []);
    await prisma.competition.updateMany({
      where: { sourceId: "39" },
      data: { enabled: true },
    });
    const count = await prisma.workOutbox.count();
    for (let i = 1; i <= 20; i++) {
      const quiet = await persistNormalizedFixture(
        prisma,
        {
          ...initial,
          receivedAt: new Date(initial.receivedAt.getTime() + i * 30000),
        },
        [],
      );
      expect(quiet.changed).toBe(false);
      expect(quiet.currentStateId).toBe(first.currentStateId);
    }
    expect(await prisma.workOutbox.count()).toBe(count);
    expect(
      await prisma.fixtureState.count({
        where: { fixtureId: first.fixtureId },
      }),
    ).toBe(1);
    const changed = await persistNormalizedFixture(
      prisma,
      { ...initial, receivedAt: new Date(now), score: { home: 1, away: 0 } },
      [goal("9020")],
    );
    const row = await work(changed);
    const payload = fixtureWorkSchema.parse(row.payload);
    expect(payload.previousObservedAt).toBe(
      new Date(now - 30000).toISOString(),
    );
    const prepared = await prepareFixtureObservation(prisma, payload);
    expect(
      prepared.find((event) => event.eventType === "goal")?.liveObservedAt,
    ).toEqual(new Date(now));
    await processFixtureDelivery(
      prisma,
      { ...payload, outboxId: row.id },
      (p) => prepareFixtureObservation(prisma, p),
    );
    const contentWork = await prisma.workOutbox.findMany({
      where: { kind: "content_generation" },
    });
    for (const item of contentWork) {
      const eventId = (item.payload as { eventId: string }).eventId;
      await processContentDelivery(prisma, { eventId, outboxId: item.id }, 160);
    }
    expect(
      await prisma.contentItem.count({
        where: {
          event: { fixtureId: first.fixtureId, eventType: "goal" },
          status: "published",
        },
      }),
    ).toBeGreaterThan(0);
    const saved = await work(changed);
    await persistNormalizedFixture(
      prisma,
      {
        ...initial,
        receivedAt: new Date(now + 30000),
        score: { home: 1, away: 0 },
      },
      [goal("9020")],
    );
    expect((await work(changed)).payload).toEqual(saved.payload);
  });
  it("withholds outage catch-up even after later successful polls and stale retries", async () => {
    const { prisma } = resources;
    const now = Date.now();
    const initial = fixture("9021", now - 600000);
    await persistNormalizedFixture(prisma, initial, []);
    const caughtUp = {
      ...initial,
      receivedAt: new Date(now),
      score: { home: 1, away: 0 },
    };
    const changed = await persistNormalizedFixture(prisma, caughtUp, [
      goal("9021"),
    ]);
    const row = await work(changed);
    const payload = fixtureWorkSchema.parse(row.payload);
    expect(payload.previousObservedAt).toBe(initial.receivedAt.toISOString());
    await persistNormalizedFixture(
      prisma,
      { ...caughtUp, receivedAt: new Date(now + 30000) },
      [goal("9021")],
    );
    await persistNormalizedFixture(prisma, initial, []);
    const prepared = await prepareFixtureObservation(prisma, payload);
    expect(prepared.length).toBeGreaterThan(0);
    expect(prepared.every((event) => event.liveObservedAt === undefined)).toBe(
      true,
    );
    expect((await work(changed)).payload).toEqual(row.payload);
  });
});
