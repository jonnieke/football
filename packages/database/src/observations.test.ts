import { describe, expect, it, vi } from "vitest";
import { prepareFixtureObservation } from "./observations.js";

const fixtureId = "01994d90-0000-7000-8000-000000000001";
const source = {
  source: "api-football",
  sourceFixtureId: "42",
  sourceEventId: "api-football:v2:42:10:none:1:none:red_card",
  sourceTeamId: "1",
  eventType: "red_card",
  minute: 10,
};
function harness(sourceEvents: unknown = [source]) {
  const before = {
    id: "before",
    fixtureId,
    status: "first_half",
    minute: 20,
    homeScore: 0,
    awayScore: 0,
  };
  const current = { ...before, id: "current", sourceEvents };
  const fixture = {
    id: fixtureId,
    source: "api-football",
    sourceFixtureId: "42",
    homeTeam: {
      id: "01994d90-0000-7000-8000-000000000002",
      source: "api-football",
      sourceId: "1",
    },
    awayTeam: {
      id: "01994d90-0000-7000-8000-000000000003",
      source: "api-football",
      sourceId: "2",
    },
  };
  const store = {
    sourceEventReview: { findMany: vi.fn().mockResolvedValue([]) },
    fixtureState: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(current),
    },
    fixture: { findUniqueOrThrow: vi.fn().mockResolvedValue(fixture) },
    player: { upsert: vi.fn() },
  };
  return {
    current,
    before,
    store,
    prisma: store as unknown as Parameters<typeof prepareFixtureObservation>[0],
    job: { fixtureId, previousStateId: "before", currentStateId: "current" },
  };
}
describe("immutable observation preparation", () => {
  it("keeps held events out of later observations without dropping lifecycle events", async () => {
    const { prisma, job, store, current } = harness();
    store.sourceEventReview.findMany.mockResolvedValue([
      { sourceEventId: source.sourceEventId },
    ]);
    current.status = "finished";
    expect(await prepareFixtureObservation(prisma, job)).toEqual([
      expect.objectContaining({ eventType: "match_finished" }),
    ]);
  });
  it("uses captured late events without assigning the current fixture score", async () => {
    const { prisma, job } = harness();
    const events = await prepareFixtureObservation(prisma, job);
    expect(events).toEqual([
      expect.objectContaining({ eventType: "red_card", minute: 10 }),
    ]);
    expect(events[0]).not.toHaveProperty("homeScore");
  });
  it("fails closed on legacy snapshots instead of refetching today's source facts", async () => {
    const { prisma, job } = harness(null);
    await expect(prepareFixtureObservation(prisma, job)).rejects.toThrow(
      "Legacy snapshot",
    );
  });
  it("rejects malformed or foreign source observations", async () => {
    const malformed = harness([{ ...source, eventType: "not-an-event" }]);
    await expect(
      prepareFixtureObservation(malformed.prisma, malformed.job),
    ).rejects.toThrow();
    const foreign = harness([{ ...source, sourceFixtureId: "99" }]);
    await expect(
      prepareFixtureObservation(foreign.prisma, foreign.job),
    ).rejects.toThrow("does not belong");
  });
  it("rejects fixture snapshot substitution", async () => {
    const { prisma, job, current } = harness();
    current.fixtureId = "foreign";
    await expect(prepareFixtureObservation(prisma, job)).rejects.toThrow(
      "does not belong",
    );
  });
  it("does not guess a correction target", async () => {
    const { prisma, job, before, current } = harness([]);
    before.homeScore = 2;
    current.homeScore = 1;
    const events = await prepareFixtureObservation(prisma, job);
    expect(events[0]?.eventType).toBe("score_correction");
    expect(events[0]).not.toHaveProperty("relatedEventId");
  });
  it("supports first-observed lifecycle work using the same snapshot as its baseline", async () => {
    const { prisma, job, before } = harness([]);
    before.id = "current";
    expect(await prepareFixtureObservation(prisma, job)).toEqual([
      expect.objectContaining({ eventType: "match_started" }),
    ]);
  });
});
