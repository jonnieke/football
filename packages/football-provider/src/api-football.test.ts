import { describe, expect, it, vi } from "vitest";
import {
  ApiFootballProvider,
  mapApiFootballStatus,
  normalizeApiFootballFixture,
} from "./index.js";

describe("API-Football normalization", () => {
  const item = (detail: string, type = "Goal", player = 123) => ({
    time: { elapsed: 45, extra: 2 },
    team: { id: 1, name: "Home" },
    player: { id: player, name: "Player" },
    type,
    detail,
  });
  function mockProvider(responses: unknown[]) {
    const fetcher = vi.fn<typeof fetch>();
    for (const response of responses)
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(response)));
    return {
      fetcher,
      provider: new ApiFootballProvider(
        {
          baseUrl: "https://example.invalid",
          apiKey: "unused",
          timeoutMs: 1000,
          maxRetries: 0,
        },
        { debug: vi.fn(), warn: vi.fn() },
        fetcher,
      ),
    };
  }
  it("keeps identities stable when source events reorder or names change", async () => {
    const goal = item("Normal Goal");
    const red = item("Red Card", "Card", 456);
    const { provider } = mockProvider([
      { response: [goal, red] },
      {
        response: [
          { ...red, player: { ...red.player, name: "Renamed" } },
          goal,
        ],
      },
    ]);
    const first = await provider.getFixtureEvents("42");
    const second = await provider.getFixtureEvents("42");
    expect(first.map((event) => event.sourceEventId).sort()).toEqual(
      second.map((event) => event.sourceEventId).sort(),
    );
  });
  it("maps supported non-score events and ignores unrelated cancellations", async () => {
    const { provider } = mockProvider([
      {
        response: [
          item("Second Yellow card", "Card"),
          item("Missed Penalty"),
          item("Goal cancelled", "Var"),
          item("Card cancelled", "Var"),
        ],
      },
    ]);
    expect(
      (await provider.getFixtureEvents("42")).map((event) => event.eventType),
    ).toEqual(["red_card", "penalty_missed", "goal_cancelled"]);
  });
  it.each([{ requests: "quota exceeded" }, ["invalid key"]])(
    "rejects HTTP 200 application errors",
    async (errors) => {
      const { provider } = mockProvider([{ errors, response: [] }]);
      await expect(provider.getFixtureEvents("42")).rejects.toMatchObject({
        code: "UPSTREAM_APPLICATION_ERROR",
      });
    },
  );
  it("uses a validated UTC date for schedule discovery", async () => {
    const { provider, fetcher } = mockProvider([{ errors: [], response: [] }]);
    await provider.getFixturesByDate("2026-09-08");
    const url = fetcher.mock.calls[0]?.[0];
    if (!(url instanceof URL)) throw new Error("Expected a request URL");
    expect(url.href).toBe(
      "https://example.invalid/fixtures?date=2026-09-08&timezone=UTC",
    );
    await expect(provider.getFixturesByDate("invalid")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
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
