import { describe, expect, it, vi } from "vitest";
import {
  ApiFootballProvider,
  mapApiFootballStatus,
  normalizeApiFootballFixture,
} from "./index.js";

describe("API-Football normalization", () => {
  it("exposes source identities instead of database foreign-key fields", async () => {
    const upstream = {
      time: { elapsed: 12, extra: null },
      team: { id: 1, name: "Arsenal" },
      player: { id: 12345, name: "Saka" },
      type: "Goal",
      detail: "Normal Goal",
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          response: [
            upstream,
            { ...upstream, player: { id: null, name: null } },
          ],
        }),
      ),
    );
    const provider = new ApiFootballProvider(
      {
        baseUrl: "https://example.invalid",
        apiKey: "test-not-used",
        timeoutMs: 1000,
        maxRetries: 0,
      },
      { debug: vi.fn(), warn: vi.fn() },
      fetcher,
    );
    const events = await provider.getFixtureEvents("42");
    expect(events[0]).toMatchObject({
      source: "api-football",
      sourceFixtureId: "42",
      sourceTeamId: "1",
      sourcePlayerId: "12345",
      playerName: "Saka",
    });
    for (const event of events) {
      expect(event).not.toHaveProperty("fixtureId");
      expect(event).not.toHaveProperty("teamId");
      expect(event).not.toHaveProperty("playerId");
    }
    expect(events[1]).not.toHaveProperty("sourcePlayerId");
    expect(events[1]).not.toHaveProperty("playerName");
  });
  it("maps every key lifecycle status", () => {
    expect(mapApiFootballStatus("NS")).toBe("scheduled");
    expect(mapApiFootballStatus("1H")).toBe("first_half");
    expect(mapApiFootballStatus("HT")).toBe("half_time");
    expect(mapApiFootballStatus("2H")).toBe("second_half");
    expect(mapApiFootballStatus("FT")).toBe("finished");
    expect(mapApiFootballStatus("new-code")).toBe("unknown");
  });

  it("does not leak the provider payload shape", () => {
    const fixture = normalizeApiFootballFixture({
      fixture: {
        id: 42,
        date: "2026-08-28T18:00:00+00:00",
        timestamp: 1,
        status: { long: "Second Half", short: "2H", elapsed: 67 },
      },
      league: {
        id: 39,
        name: "Premier League",
        country: "England",
        season: 2026,
      },
      teams: {
        home: { id: 1, name: "Arsenal" },
        away: { id: 2, name: "Chelsea" },
      },
      goals: { home: 2, away: 1 },
    });
    expect(fixture).toMatchObject({
      sourceFixtureId: "42",
      status: "second_half",
      score: { home: 2, away: 1 },
      competition: { slug: "premier-league" },
    });
    expect(fixture).not.toHaveProperty("league");
  });
});
