import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "./generated/prisma/client.ts";

export const MAX_PER_GAME_NOTIFICATIONS = 4;
export const MAX_IN_GAME_NOTIFICATIONS = 3;
export const MAX_FINAL_SCORE_NOTIFICATIONS = 1;
export const MAX_DAILY_PRE_MATCH_APPROVALS = 4; // Maintained for legacy compatibility

export const IN_GAME_SCORE_EVENT_TYPES = [
  "goal",
  "own_goal",
  "penalty_goal",
  "score_updated",
  "score_correction",
] as const;

export const FINAL_SCORE_EVENT_TYPES = [
  "match_finished",
] as const;

export const SCORE_EVENT_TYPES = [
  ...IN_GAME_SCORE_EVENT_TYPES,
  ...FINAL_SCORE_EVENT_TYPES,
] as const;

export type InGameScoreEventType = (typeof IN_GAME_SCORE_EVENT_TYPES)[number];
export type FinalScoreEventType = (typeof FINAL_SCORE_EVENT_TYPES)[number];
export type ScoreEventType = (typeof SCORE_EVENT_TYPES)[number];

export const PRE_MATCH_DETAIL_TYPES = [
  "scores",
  "goals",
  "scorer",
  "red_card",
  "yellow_card",
  "duration",
] as const;

export type PreMatchDetailType = (typeof PRE_MATCH_DETAIL_TYPES)[number];

export class PreMatchQuotaExceededError extends Error {
  constructor(
    message = `Regulatory limit reached: Maximum of ${MAX_PER_GAME_NOTIFICATIONS} notification items allowed per game.`,
  ) {
    super(message);
    this.name = "PreMatchQuotaExceededError";
  }
}

export const preMatchToggleSchema = z
  .object({
    date: z.iso.date(),
    fixtureId: z.uuid(),
    detailType: z.enum(PRE_MATCH_DETAIL_TYPES).default("scores"),
    approved: z.boolean(),
  })
  .strict();

export type PreMatchToggleInput = z.infer<typeof preMatchToggleSchema>;

/**
 * Returns the current date string (YYYY-MM-DD) in East Africa Time (EAT = UTC+3).
 */
export function getEATDateString(date: Date = new Date()): string {
  const eatTime = new Date(date.getTime() + 3 * 3600 * 1000);
  return eatTime.toISOString().slice(0, 10);
}

/**
 * Returns the UTC Date bounds for a given YYYY-MM-DD in East Africa Time (EAT = UTC+3).
 * 00:00:00 EAT is 21:00:00 UTC on the previous calendar day.
 */
export function getEATDayRange(dateStr: string): { start: Date; end: Date } {
  z.iso.date().parse(dateStr);
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const start = new Date(Date.UTC(year, month - 1, day - 1, 21, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day, 21, 0, 0, 0));
  return { start, end };
}

/**
 * Checks whether an event is an in-game live score event (max 3 per game).
 */
export function isInGameScoreEvent(eventType: string): boolean {
  return (IN_GAME_SCORE_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Checks whether an event is a final score event at full-time (max 1 per game).
 */
export function isFinalScoreEvent(eventType: string): boolean {
  return (FINAL_SCORE_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Checks whether an event is a score event (in-game or final score).
 * Regulators and platform policy only allow pushing scores (no red cards, yellow cards, duration).
 */
export function isScoreEvent(eventType: string): boolean {
  return (SCORE_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Checks whether an event type for a fixture is approved under pre-match approvals.
 * Only score events (in-game scores and final score) are allowed to be pushed.
 */
export function isEventTypeCoveredByDetails(
  eventType: string,
  approvedDetailTypes: Set<string>,
): boolean {
  if (!isScoreEvent(eventType)) {
    return false;
  }
  return (
    approvedDetailTypes.has("scores") ||
    approvedDetailTypes.has("goals") ||
    approvedDetailTypes.has("final_score") ||
    approvedDetailTypes.has("scorer")
  );
}

export async function listPreMatchApprovals(prisma: PrismaClient, date: string) {
  z.iso.date().parse(date);
  const { start, end } = getEATDayRange(date);
  const todayEAT = getEATDateString();
  const isToday = date === todayEAT;

  // Retrieve fixtures for this EAT date, plus live fixtures if looking at today
  const fixtures = await prisma.fixture.findMany({
    where: {
      source: "api-football",
      competition: { enabled: true },
      OR: [
        { kickoffAt: { gte: start, lt: end } },
        ...(isToday
          ? [
              {
                status: {
                  in: [
                    "first_half",
                    "half_time",
                    "second_half",
                    "extra_time",
                    "penalty_shootout",
                  ],
                },
              },
            ]
          : []),
      ],
    },
    orderBy: [{ kickoffAt: "asc" }, { id: "asc" }],
    take: 501,
    select: {
      id: true,
      kickoffAt: true,
      status: true,
      minute: true,
      homeScore: true,
      awayScore: true,
      lastPolledAt: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
      competition: { select: { name: true, season: true } },
    },
  });

  // Get active pre-match approvals for this date
  const approvals = await prisma.preMatchApproval.findMany({
    where: { date },
    select: {
      id: true,
      fixtureId: true,
      detailType: true,
      approvedBy: true,
      createdAt: true,
    },
  });

  // Map fixture approvals
  const approvalMap = new Map<string, Set<string>>();
  for (const app of approvals) {
    let set = approvalMap.get(app.fixtureId);
    if (!set) {
      set = new Set();
      approvalMap.set(app.fixtureId, set);
    }
    set.add(app.detailType);
  }

  // Count delivered push notifications per fixture
  const fixtureIds = fixtures.map((f) => f.id);
  const deliveredRows =
    fixtureIds.length > 0 && typeof prisma.stagingPushDelivery?.findMany === "function"
      ? await prisma.stagingPushDelivery.findMany({
          where: {
            status: "delivered",
            content: {
              event: {
                fixtureId: { in: fixtureIds },
              },
            },
          },
          select: {
            content: {
              select: {
                event: {
                  select: {
                    fixtureId: true,
                    eventType: true,
                  },
                },
              },
            },
          },
        })
      : [];

  const fixturePushedCounts = new Map<
    string,
    { total: number; inGame: number; finalScore: number }
  >();
  for (const row of deliveredRows) {
    const fId = row.content?.event?.fixtureId;
    const eventType = row.content?.event?.eventType ?? "";
    if (fId) {
      const counts = fixturePushedCounts.get(fId) ?? {
        total: 0,
        inGame: 0,
        finalScore: 0,
      };
      counts.total += 1;
      if (isInGameScoreEvent(eventType)) counts.inGame += 1;
      if (isFinalScoreEvent(eventType)) counts.finalScore += 1;
      fixturePushedCounts.set(fId, counts);
    }
  }

  // Count delivered push notifications today in EAT
  const pushedTodayCount =
    typeof prisma.stagingPushDelivery?.count === "function"
      ? await prisma.stagingPushDelivery.count({
          where: {
            status: "delivered",
            completedAt: { gte: start, lt: end },
          },
        })
      : 0;

  const items = fixtures.slice(0, 500).map((f) => {
    const fixtureApprovals = approvalMap.get(f.id) ?? new Set<string>();
    const counts = fixturePushedCounts.get(f.id) ?? {
      total: 0,
      inGame: 0,
      finalScore: 0,
    };
    const pushedCount = counts.total;
    const inGameCount = counts.inGame;
    const finalScoreCount = counts.finalScore;
    const isLimitReached = pushedCount >= MAX_PER_GAME_NOTIFICATIONS;
    const approved =
      fixtureApprovals.has("scores") || fixtureApprovals.has("goals");
    const includeScorer = fixtureApprovals.has("scorer");

    return {
      ...f,
      pushedCount,
      inGameCount,
      finalScoreCount,
      maxPerGame: MAX_PER_GAME_NOTIFICATIONS,
      maxInGame: MAX_IN_GAME_NOTIFICATIONS,
      maxFinalScore: MAX_FINAL_SCORE_NOTIFICATIONS,
      isLimitReached,
      approved,
      includeScorer,
      approvals: {
        scores: approved,
        goals: approved,
        scorer: includeScorer,
        red_card: false,
        yellow_card: false,
        duration: false,
      },
    };
  });

  const approvedCount = items.filter((i) => i.approved).length;

  return {
    date,
    todayEAT,
    totalMatches: fixtures.length,
    approvedMatchesCount: approvedCount,
    maxPerGame: MAX_PER_GAME_NOTIFICATIONS,
    selectedCount: approvedCount,
    maxAllowed: fixtures.length,
    isMaxReached: false,
    pushedTodayCount,
    items,
    truncated: fixtures.length > 500,
    checkedAt: new Date().toISOString(),
  };
}

export async function togglePreMatchApproval(
  prisma: PrismaClient,
  input: unknown,
  actor: string,
) {
  const parsed = preMatchToggleSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pre_match_${parsed.date}`}))`;

    if (parsed.approved) {
      const existing = await tx.preMatchApproval.findUnique({
        where: {
          date_fixtureId_detailType: {
            date: parsed.date,
            fixtureId: parsed.fixtureId,
            detailType: parsed.detailType,
          },
        },
      });
      if (existing) {
        return existing;
      }

      return tx.preMatchApproval.create({
        data: {
          id: randomUUID(),
          date: parsed.date,
          fixtureId: parsed.fixtureId,
          detailType: parsed.detailType,
          approvedBy: actor,
        },
      });
    } else {
      // Remove approval for this detail type (and also alias detail types if scores/goals)
      const detailTypesToDelete =
        parsed.detailType === "scores" || parsed.detailType === "goals"
          ? ["scores", "goals"]
          : [parsed.detailType];

      await tx.preMatchApproval.deleteMany({
        where: {
          date: parsed.date,
          fixtureId: parsed.fixtureId,
          detailType: { in: detailTypesToDelete },
        },
      });
      return null;
    }
  });
}
