import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  persistNormalizedFixture,
  prepareFixtureObservation,
  processFixtureDelivery,
  processContentDelivery,
} from "@fcp/database";
import type {
  NormalizedFixture,
  NormalizedSourceEvent,
} from "@fcp/football-core";
import { createTestResources } from "../support/resources.js";

const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("stored fixture observations (PostgreSQL; direct consumer calls)", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
  }, 90_000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30_000);
  it("captures event-only changes, replays immutably, reconciles finish, and rejects stale writers", async () => {
    const { prisma } = resources;
    const fixture: NormalizedFixture = {
      id: "source-fixture",
      source: "api-football",
      sourceFixtureId: "9010",
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
      status: "scheduled",
      score: { home: 0, away: 0 },
      kickoffAt: new Date("2026-09-08T12:00:00Z"),
      receivedAt: new Date("2026-09-08T11:00:00Z"),
    };
    const initial = await persistNormalizedFixture(prisma, fixture, []);
    const playing = {
      ...fixture,
      status: "first_half" as const,
      minute: 12,
      receivedAt: new Date("2026-09-08T12:12:00Z"),
    };
    await persistNormalizedFixture(prisma, playing, []);
    const red: NormalizedSourceEvent = {
      source: "api-football",
      sourceFixtureId: "9010",
      sourceEventId: "api-football:v2:9010:10:none:1:123:red_card",
      sourceTeamId: "1",
      sourcePlayerId: "123",
      playerName: "Player",
      minute: 10,
      eventType: "red_card",
    };
    const withCard = {
      ...playing,
      receivedAt: new Date("2026-09-08T12:13:00Z"),
    };
    expect(
      (await persistNormalizedFixture(prisma, withCard, [red])).changed,
    ).toBe(true);
    const goals: NormalizedSourceEvent[] = [11, 12].map((minute) => ({
      ...red,
      sourceEventId: `api-football:v2:9010:${minute}:none:1:123:goal`,
      eventType: "goal",
      minute,
    }));
    const scoring = {
      ...playing,
      minute: 20,
      score: { home: 2, away: 0 },
      receivedAt: new Date("2026-09-08T12:20:00Z"),
    };
    await persistNormalizedFixture(prisma, scoring, [red, ...goals]);
    const snapshotCount = await prisma.fixtureState.count();
    expect(
      (
        await persistNormalizedFixture(
          prisma,
          { ...scoring, receivedAt: new Date("2026-09-08T12:21:00Z") },
          [...goals].reverse().concat(red),
        )
      ).changed,
    ).toBe(false);
    expect(await prisma.fixtureState.count()).toBe(snapshotCount);
    // JSONB property order and minute-only changes must not enqueue new work.
    const workCount = await prisma.workOutbox.count();
    expect(
      (
        await persistNormalizedFixture(
          prisma,
          {
            ...scoring,
            minute: 21,
            receivedAt: new Date("2026-09-08T12:22:00Z"),
          },
          [red, ...goals],
        )
      ).changed,
    ).toBe(false);
    expect(await prisma.workOutbox.count()).toBe(workCount);
    const finished = {
      ...scoring,
      status: "finished" as const,
      minute: 90,
      receivedAt: new Date("2026-09-08T14:00:00Z"),
    };
    await Promise.all([
      persistNormalizedFixture(prisma, finished, [red, ...goals]),
      persistNormalizedFixture(prisma, withCard, [red]),
    ]);
    expect(
      (
        await prisma.fixture.findUniqueOrThrow({
          where: { id: initial.fixtureId },
        })
      ).status,
    ).toBe("finished");
    const work = await prisma.workOutbox.findMany({
      where: { kind: "fixture_change" },
      orderBy: { id: "asc" },
    });
    for (const row of work) {
      const job = {
        ...(row.payload as {
          fixtureId: string;
          previousStateId: string;
          currentStateId: string;
        }),
        outboxId: row.id,
      };
      await processFixtureDelivery(prisma, job, (payload) =>
        prepareFixtureObservation(prisma, payload),
      );
      await processFixtureDelivery(prisma, job, () => {
        throw new Error("Completed work must not prepare again");
      });
    }
    const events = await prisma.footballEvent.findMany();
    expect(events.filter((event) => event.eventType === "goal")).toHaveLength(
      2,
    );
    expect(
      events.filter((event) => event.eventType === "red_card"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.eventType === "match_started"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.eventType === "match_finished"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.eventType === "score_updated"),
    ).toHaveLength(1);
    for (const event of events)
      await processContentDelivery(prisma, { eventId: event.id }, 160);
    const cardContent = await prisma.contentItem.findFirstOrThrow({
      where: { event: { eventType: "red_card" } },
    });
    expect(cardContent.standardText).toContain("Home v Away");
    expect(cardContent.standardText).not.toContain("2-0");
  }, 60_000);
});
