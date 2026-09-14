import type { PrismaClient } from "@fcp/database";
import { redisKey } from "@fcp/shared";

export const workerNames = [
  "football-ingestion",
  "outbox-dispatcher",
  "event-processor",
  "content-generator",
] as const;
export function heartbeatState(value: string | null, now: number) {
  const time = value === null ? NaN : Date.parse(value);
  if (!Number.isFinite(time) || time > now + 5000)
    return { state: "unknown", lastSeen: null };
  return {
    state: now - time <= 65000 ? "recent" : "stale",
    lastSeen: new Date(time).toISOString(),
  };
}
/** Read-only operational snapshot. Never calls the football provider. */
export function dashboardReader(
  prisma: PrismaClient,
  redis: { get(key: string): Promise<string | null> },
  prefix: string,
) {
  const read = async () => {
    const now = Date.now();
    const [database, queue] = await Promise.allSettled([
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`;
          const competitions = await tx.competition.findMany({
            where: { enabled: true },
            orderBy: [{ priority: "asc" }, { id: "asc" }],
            take: 50,
            select: { name: true, season: true, country: true },
          });
          const polls = await tx.pollingRun.findMany({
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            take: 10,
            select: {
              status: true,
              startedAt: true,
              finishedAt: true,
              fixturesRetrieved: true,
              changedFixtures: true,
              durationMs: true,
            },
          });
          const fixtures = await tx.fixture.findMany({
            orderBy: [{ kickoffAt: "desc" }, { id: "desc" }],
            take: 20,
            select: {
              id: true,
              kickoffAt: true,
              status: true,
              homeScore: true,
              awayScore: true,
              lastPolledAt: true,
              homeTeam: { select: { name: true } },
              awayTeam: { select: { name: true } },
              competition: { select: { name: true } },
            },
          });
          const content = await tx.contentItem.findMany({
            orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
            take: 20,
            select: {
              id: true,
              channel: true,
              status: true,
              shortText: true,
              publishedAt: true,
            },
          });
          const pending = await tx.workOutbox.count({
            where: { completedAt: null, pausedAt: null },
          });
          const paused = await tx.workOutbox.count({
            where: { completedAt: null, pausedAt: { not: null } },
          });
          const reviews = await tx.sourceEventReview.count({
            where: { status: "pending" },
          });
          return {
            competitions,
            polls,
            fixtures,
            content,
            pending,
            paused,
            reviews,
          };
        },
        { maxWait: 3000, timeout: 8000, isolationLevel: "RepeatableRead" },
      ),
      Promise.all(
        workerNames.map(async (name) => ({
          name,
          ...heartbeatState(
            await redis.get(redisKey(`health:worker:${name}`, prefix)),
            now,
          ),
        })),
      ),
    ]);
    return {
      observedAt: new Date(now).toISOString(),
      namespace: prefix,
      database: database.status === "fulfilled" ? "connected" : "unavailable",
      redis: queue.status === "fulfilled" ? "connected" : "unavailable",
      workers:
        queue.status === "fulfilled"
          ? queue.value
          : workerNames.map((name) => ({
              name,
              state: "unknown",
              lastSeen: null,
            })),
      data: database.status === "fulfilled" ? database.value : null,
      quota: {
        remaining: null,
        note: "Not collected yet. Opening this dashboard does not consume football API requests.",
      },
    };
  };
  let pending: ReturnType<typeof read> | undefined;
  let expires = 0;
  return () => {
    if (!pending || Date.now() >= expires) {
      expires = Infinity;
      pending = read().finally(() => {
        expires = Date.now() + 10000;
      });
    }
    return pending;
  };
}
