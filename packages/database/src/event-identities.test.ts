import { describe, expect, it, vi } from "vitest";
import type { NormalizedSourceEvent } from "@fcp/football-core";
import { createCanonicalEvent } from "./events.js";
import {
  assertInternalEventIds,
  resolveSourceEventIdentities,
  type IdentityFixture,
} from "./event-identities.js";

const ids = {
  fixture: "01994d90-0000-7000-8000-000000000001",
  home: "01994d90-0000-7000-8000-000000000002",
  away: "01994d90-0000-7000-8000-000000000003",
  player: "01994d90-0000-7000-8000-000000000004",
};
const fixture: IdentityFixture = {
  id: ids.fixture,
  source: "api-football",
  sourceFixtureId: "42",
  homeTeam: { id: ids.home, source: "api-football", sourceId: "1" },
  awayTeam: { id: ids.away, source: "api-football", sourceId: "2" },
};
const source: NormalizedSourceEvent = {
  source: "api-football",
  sourceFixtureId: "42",
  sourceEventId: "goal-1",
  sourceTeamId: "1",
  sourcePlayerId: "12345",
  playerName: "Saka",
  eventType: "goal",
  minute: 12,
  extraTime: 1,
  homeScore: 1,
  awayScore: 0,
};
function store() {
  return {
    player: {
      upsert: vi.fn().mockResolvedValue({ id: ids.player }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

describe("provider identity resolution", () => {
  it("resolves provider IDs and retains event facts", async () => {
    const db = store();
    const result = await resolveSourceEventIdentities(db, fixture, source);
    expect(result).toEqual({
      issues: [],
      event: {
        fixtureId: ids.fixture,
        teamId: ids.home,
        playerId: ids.player,
        playerName: "Saka",
        eventType: "goal",
        sourceEventId: "goal-1",
        minute: 12,
        extraTime: 1,
        homeScore: 1,
        awayScore: 0,
      },
    });
    expect(db.player.upsert).toHaveBeenCalledWith({
      where: { source_sourceId: { source: "api-football", sourceId: "12345" } },
      create: {
        id: expect.any(String) as unknown,
        source: "api-football",
        sourceId: "12345",
        name: "Saka",
      },
      update: { name: "Saka" },
      select: { id: true },
    });
    expect(source.sourcePlayerId).toBe("12345");
  });
  it("maps away-team IDs", async () => {
    const result = await resolveSourceEventIdentities(store(), fixture, {
      ...source,
      sourceTeamId: "2",
    });
    expect(result.event.teamId).toBe(ids.away);
  });
  it("never carries an unknown team or unexpected raw foreign keys through", async () => {
    const input = {
      ...source,
      sourceTeamId: "999",
      teamId: "999",
      playerId: "12345",
      fixtureId: "42",
    };
    const result = await resolveSourceEventIdentities(store(), fixture, input);
    expect(result.issues).toEqual(["UNKNOWN_SOURCE_TEAM"]);
    expect(result.event).not.toHaveProperty("teamId");
    expect(result.event.playerId).toBe(ids.player);
    expect(result.event.fixtureId).toBe(ids.fixture);
  });
  it("does not look up or invent players by name", async () => {
    const db = store();
    const input = { ...source };
    delete input.sourcePlayerId;
    const result = await resolveSourceEventIdentities(db, fixture, input);
    expect(result.issues).toContain("PLAYER_ID_MISSING");
    expect(result.event.playerName).toBe("Saka");
    expect(result.event).not.toHaveProperty("playerId");
    expect(db.player.upsert).not.toHaveBeenCalled();
    expect(db.player.findUnique).not.toHaveBeenCalled();
  });
  it("accepts events without any player or team attribution", async () => {
    const db = store();
    const result = await resolveSourceEventIdentities(db, fixture, {
      source: "api-football",
      sourceFixtureId: "42",
      eventType: "half_time",
    });
    expect(result).toEqual({
      issues: [],
      event: { fixtureId: ids.fixture, eventType: "half_time" },
    });
    expect(db.player.upsert).not.toHaveBeenCalled();
  });
  it("keeps the UUID for nameless players without replacing a known name", async () => {
    const db = store();
    const result = await resolveSourceEventIdentities(db, fixture, {
      ...source,
      playerName: "  ",
    });
    expect(result.event.playerId).toBe(ids.player);
    expect(result.event).not.toHaveProperty("playerName");
    expect(result.issues).toContain("PLAYER_NAME_MISSING");
    expect(db.player.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });
  it("uses provider-scoped IDs consistently on retries", async () => {
    const db = store();
    const first = await resolveSourceEventIdentities(db, fixture, source);
    const second = await resolveSourceEventIdentities(db, fixture, {
      ...source,
      playerName: "Bukayo Saka",
    });
    expect(first.event.playerId).toBe(second.event.playerId);
    expect(db.player.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          source_sourceId: { source: "api-football", sourceId: "12345" },
        },
        update: { name: "Bukayo Saka" },
      }),
    );
  });
  it("separates synthetic and upstream player identities", async () => {
    const db = store();
    const synthetic = {
      ...fixture,
      source: "synthetic",
      homeTeam: { ...fixture.homeTeam, source: "synthetic" },
      awayTeam: { ...fixture.awayTeam, source: "synthetic" },
    };
    await resolveSourceEventIdentities(db, synthetic, {
      ...source,
      source: "synthetic",
    });
    expect(db.player.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source_sourceId: { source: "synthetic", sourceId: "12345" } },
      }),
    );
  });
  it.each([
    { ...source, sourceFixtureId: "43" },
    { ...source, source: "synthetic" as const },
  ])("rejects a mismatched fixture/provider before writing", async (input) => {
    const db = store();
    await expect(
      resolveSourceEventIdentities(db, fixture, input),
    ).rejects.toThrow("does not belong");
    expect(db.player.upsert).not.toHaveBeenCalled();
  });
  it("rejects blank source player IDs before writing", async () => {
    const db = store();
    await expect(
      resolveSourceEventIdentities(db, fixture, {
        ...source,
        sourcePlayerId: " ",
      }),
    ).rejects.toThrow("must not be blank");
    expect(db.player.upsert).not.toHaveBeenCalled();
  });
  it("recovers the winning UUID after a concurrent unique conflict", async () => {
    const db = store();
    db.player.upsert.mockRejectedValueOnce({ code: "P2002" });
    db.player.findUnique.mockResolvedValueOnce({ id: ids.player });
    expect(
      (await resolveSourceEventIdentities(db, fixture, source)).event.playerId,
    ).toBe(ids.player);
    expect(db.player.findUnique).toHaveBeenCalledWith({
      where: { source_sourceId: { source: "api-football", sourceId: "12345" } },
      select: { id: true },
    });
  });
  it("does not swallow failed upserts", async () => {
    const db = store();
    db.player.upsert.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      resolveSourceEventIdentities(db, fixture, source),
    ).rejects.toThrow("database unavailable");
    expect(db.player.findUnique).not.toHaveBeenCalled();
  });
  it("rethrows unique conflicts when no winner exists", async () => {
    const db = store();
    const error = { code: "P2002" };
    db.player.upsert.mockRejectedValueOnce(error);
    await expect(
      resolveSourceEventIdentities(db, fixture, source),
    ).rejects.toBe(error);
  });
});

describe("canonical identity validation", () => {
  it.each(["fixtureId", "teamId", "playerId", "relatedEventId"] as const)(
    "refuses persistence before accessing the database for invalid %s",
    async (field) => {
      // Deliberately no database methods: the identity guard must run first.
      const unavailable = {} as Parameters<typeof createCanonicalEvent>[0];
      await expect(
        createCanonicalEvent(unavailable, {
          eventType: "goal",
          fixtureId: ids.fixture,
          [field]: "12345",
        }),
      ).rejects.toThrow(`internal UUID for ${field}`);
    },
  );
  it.each(["fixtureId", "teamId", "playerId", "relatedEventId"] as const)(
    "rejects a provider ID in %s",
    (field) => {
      expect(() =>
        assertInternalEventIds({ fixtureId: ids.fixture, [field]: "12345" }),
      ).toThrow("internal UUID");
    },
  );
});
