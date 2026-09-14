import { describe, expect, it, vi } from "vitest";
import {
  captureCompletedMatch,
  decodeCapture,
  completedFixtureId,
} from "../../scripts/replay-capture.js";
import { replayPreview } from "../../scripts/replay-preview.js";

const fixtureResponse = {
  errors: [],
  response: [
    {
      fixture: {
        id: 123,
        date: "2025-01-01T15:00:00+00:00",
        timestamp: 1735743600,
        status: { short: "FT", long: "Match Finished", elapsed: 90 },
      },
      league: {
        id: 39,
        name: "Premier League",
        country: "England",
        season: 2024,
      },
      teams: { home: { id: 1, name: "Home" }, away: { id: 2, name: "Away" } },
      goals: { home: 1, away: 0 },
    },
  ],
};
const eventsResponse = {
  errors: [],
  response: [
    {
      time: { elapsed: 30, extra: null },
      team: { id: 1, name: "Home" },
      player: { id: 12, name: "Player" },
      type: "Goal",
      detail: "Normal Goal",
    },
  ],
};
const capture = {
  version: 1,
  capturedAt: "2025-01-02T00:00:00Z",
  fixtureId: "123",
  fixtureResponse,
  eventsResponse,
};

describe("bounded historical capture and local preview", () => {
  it("makes exactly three requests to the fixed provider, with no redirects", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const payload of [fixtureResponse, fixtureResponse, eventsResponse])
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(payload)));
    const result = await captureCompletedMatch("test-secret", fetcher);
    expect(result.requests).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain("test-secret");
    for (const [input, init] of fetcher.mock.calls) {
      expect(
        new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        ).origin,
      ).toBe("https://v3.football.api-sports.io");
      expect(init?.redirect).toBe("error");
    }
  });
  it("does not retry errors or interpret an error envelope as no matches", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(captureCompletedMatch("key", fetcher)).rejects.toThrow("429");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(() =>
      completedFixtureId({ errors: { requests: "quota" }, response: [] }),
    ).toThrow();
  });
  it("rejects live matches and other competitions before fetching events", () => {
    for (const change of ["live", "league"]) {
      const data = structuredClone(fixtureResponse);
      if (change === "live") data.response[0]!.fixture.status.short = "1H";
      else data.response[0]!.league.id = 2;
      expect(() => completedFixtureId(data)).toThrow();
    }
  });
  it("decodes offline without inventing intermediate scores", async () => {
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network forbidden"));
    try {
      const decoded = await decodeCapture(capture);
      expect(decoded.fixture.score).toEqual({ home: 1, away: 0 });
      expect(decoded.events).toHaveLength(1);
      expect(decoded.events[0]).not.toHaveProperty("homeScore");
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it("rejects tampered identities, future kickoff, wrong teams and event errors", async () => {
    await expect(
      decodeCapture({ ...capture, fixtureId: "456" }),
    ).rejects.toThrow();
    await expect(
      decodeCapture({ ...capture, capturedAt: "2024-01-01T00:00:00Z" }),
    ).rejects.toThrow();
    const bad = structuredClone(eventsResponse);
    bad.response[0]!.team.id = 999;
    await expect(
      decodeCapture({ ...capture, eventsResponse: bad }),
    ).rejects.toThrow();
    await expect(
      decodeCapture({
        ...capture,
        eventsResponse: { errors: { auth: "bad" }, response: [] },
      }),
    ).rejects.toThrow();
  });
  it("escapes upstream text and visibly labels output as test-only", () => {
    const html = replayPreview({
      match: "<script>alert(1)</script>",
      kickoff: "date",
      capturedAt: "date",
      fixtureId: "123",
      captureSha256: "hash",
      sourceEvents: 1,
      canonicalEvents: 1,
      reviews: 0,
      pending: 0,
      duplicateCheckPassed: true,
      content: [
        {
          eventType: "goal",
          minute: 30,
          extraTime: null,
          shortText: '<img src="x">',
          standardText: "<script>bad</script>",
        },
      ],
    });
    expect(html).toContain("TEST ONLY");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).toContain("default-src 'none'");
  });
});
