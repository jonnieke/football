import { describe, expect, it, vi } from "vitest";
import {
  getEATDateString,
  getEATDayRange,
  isEventTypeCoveredByDetails,
  isFinalScoreEvent,
  isInGameScoreEvent,
  isScoreEvent,
  listPreMatchApprovals,
  MAX_FINAL_SCORE_NOTIFICATIONS,
  MAX_IN_GAME_NOTIFICATIONS,
  MAX_PER_GAME_NOTIFICATIONS,
  togglePreMatchApproval,
} from "./pre-match.js";

describe("pre-match approvals business logic", () => {
  it("computes accurate East Africa Time (EAT = UTC+3) dates and day boundaries", () => {
    // 2026-11-04 at 00:30 EAT is 2026-11-03 21:30 UTC
    const dateAtNight = new Date("2026-11-03T21:30:00.000Z");
    expect(getEATDateString(dateAtNight)).toBe("2026-11-04");

    // 2026-11-04 at 23:30 EAT is 2026-11-04 20:30 UTC
    const dateLate = new Date("2026-11-04T20:30:00.000Z");
    expect(getEATDateString(dateLate)).toBe("2026-11-04");

    const range = getEATDayRange("2026-11-04");
    expect(range.start.toISOString()).toBe("2026-11-03T21:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-04T21:00:00.000Z");
    expect(range.end.getTime() - range.start.getTime()).toBe(24 * 3600 * 1000);
  });

  it("restricts notifications strictly to score events (live scores and final score, no cards)", () => {
    // In-game score events
    expect(isInGameScoreEvent("goal")).toBe(true);
    expect(isInGameScoreEvent("own_goal")).toBe(true);
    expect(isInGameScoreEvent("penalty_goal")).toBe(true);
    expect(isInGameScoreEvent("score_updated")).toBe(true);
    expect(isInGameScoreEvent("score_correction")).toBe(true);
    expect(isInGameScoreEvent("match_finished")).toBe(false);

    // Final score event
    expect(isFinalScoreEvent("match_finished")).toBe(true);
    expect(isFinalScoreEvent("goal")).toBe(false);

    // Score events (live + final score)
    expect(isScoreEvent("goal")).toBe(true);
    expect(isScoreEvent("own_goal")).toBe(true);
    expect(isScoreEvent("penalty_goal")).toBe(true);
    expect(isScoreEvent("score_updated")).toBe(true);
    expect(isScoreEvent("score_correction")).toBe(true);
    expect(isScoreEvent("match_finished")).toBe(true);

    // Non-score events are strictly blocked
    expect(isScoreEvent("red_card")).toBe(false);
    expect(isScoreEvent("yellow_card")).toBe(false);
    expect(isScoreEvent("match_started")).toBe(false);
    expect(isScoreEvent("half_time")).toBe(false);

    // Only approved score events return true
    expect(isEventTypeCoveredByDetails("goal", new Set(["scores"]))).toBe(true);
    expect(isEventTypeCoveredByDetails("goal", new Set(["goals"]))).toBe(true);
    expect(isEventTypeCoveredByDetails("goal", new Set(["scorer"]))).toBe(true);
    expect(isEventTypeCoveredByDetails("match_finished", new Set(["scores"]))).toBe(true);

    // Cards and duration are rejected even if in the set
    expect(isEventTypeCoveredByDetails("red_card", new Set(["red_card", "scores"]))).toBe(false);
    expect(isEventTypeCoveredByDetails("yellow_card", new Set(["yellow_card", "scores"]))).toBe(false);
    expect(isEventTypeCoveredByDetails("match_started", new Set(["duration", "scores"]))).toBe(false);
  });

  it("lists matches and computes per-game pushed counts against 4 maximum", async () => {
    const fixture = {
      id: "f1111111-0000-4000-8000-000000000001",
      kickoffAt: new Date("2026-11-04T17:00:00.000Z"),
      status: "second_half",
      minute: 65,
      homeScore: 2,
      awayScore: 1,
      lastPolledAt: null,
      homeTeam: { name: "Arsenal" },
      awayTeam: { name: "Chelsea" },
      competition: { name: "Premier League", season: 2026 },
    };

    const approvals = [
      {
        id: "a1",
        fixtureId: fixture.id,
        detailType: "scores",
        approvedBy: "editor@example.com",
        createdAt: new Date(),
      },
    ];

    const prisma = {
      fixture: { findMany: vi.fn().mockResolvedValue([fixture]) },
      preMatchApproval: { findMany: vi.fn().mockResolvedValue(approvals) },
      stagingPushDelivery: {
        findMany: vi.fn().mockResolvedValue([
          { content: { event: { fixtureId: fixture.id, eventType: "goal" } } },
          { content: { event: { fixtureId: fixture.id, eventType: "goal" } } },
        ]),
        count: vi.fn().mockResolvedValue(2),
      },
    };

    const result = await listPreMatchApprovals(prisma as never, "2026-11-04");
    expect(MAX_PER_GAME_NOTIFICATIONS).toBe(4);
    expect(MAX_IN_GAME_NOTIFICATIONS).toBe(3);
    expect(MAX_FINAL_SCORE_NOTIFICATIONS).toBe(1);
    expect(result.date).toBe("2026-11-04");
    expect(result.totalMatches).toBe(1);
    expect(result.approvedMatchesCount).toBe(1);
    expect(result.maxPerGame).toBe(4);
    expect(result.items[0]?.pushedCount).toBe(2);
    expect(result.items[0]?.inGameCount).toBe(2);
    expect(result.items[0]?.finalScoreCount).toBe(0);
    expect(result.items[0]?.maxPerGame).toBe(4);
    expect(result.items[0]?.maxInGame).toBe(3);
    expect(result.items[0]?.maxFinalScore).toBe(1);
    expect(result.items[0]?.isLimitReached).toBe(false);
    expect(result.items[0]?.approved).toBe(true);
    expect(result.items[0]?.approvals.scores).toBe(true);
  });

  it("allows toggling score approvals for matches", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      preMatchApproval: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "pm1" }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (innerTx: typeof tx) => Promise<unknown>) =>
          cb(tx),
        ),
    };

    await togglePreMatchApproval(
      prisma as never,
      {
        date: "2026-11-04",
        fixtureId: "f1111111-0000-4000-8000-000000000001",
        detailType: "scores",
        approved: true,
      },
      "editor@example.com",
    );
    expect(tx.preMatchApproval.create).toHaveBeenCalled();
    const createCall = tx.preMatchApproval.create.mock.calls[0]?.[0] as {
      data?: Record<string, unknown>;
    };
    expect(createCall?.data).toMatchObject({
      date: "2026-11-04",
      fixtureId: "f1111111-0000-4000-8000-000000000001",
      detailType: "scores",
      approvedBy: "editor@example.com",
    });

    await togglePreMatchApproval(
      prisma as never,
      {
        date: "2026-11-04",
        fixtureId: "f1111111-0000-4000-8000-000000000001",
        detailType: "scores",
        approved: false,
      },
      "editor@example.com",
    );
    expect(tx.preMatchApproval.deleteMany).toHaveBeenCalledWith({
      where: {
        date: "2026-11-04",
        fixtureId: "f1111111-0000-4000-8000-000000000001",
        detailType: { in: ["scores", "goals"] },
      },
    });
  });
});
