import { Worker } from "bullmq";
import {
  processFixtureDelivery,
  getPrisma,
  resolveSourceEventIdentities,
} from "@fcp/database";
import {
  detectFixtureEvents,
  type FixtureState,
  type NormalizedFootballEvent,
  type EventDraft,
} from "@fcp/football-core";
import { ApiFootballProvider } from "@fcp/football-provider";
import {
  createLogger,
  createRedis,
  loadConfig,
  Metrics,
  QUEUE_NAMES,
  type FixtureChangeJob,
} from "@fcp/shared";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL).child({
  worker: "event-processor",
});
const prisma = getPrisma(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const metrics = new Metrics();
const provider = new ApiFootballProvider(
  {
    baseUrl: config.API_FOOTBALL_BASE_URL,
    apiKey: config.API_FOOTBALL_KEY,
    timeoutMs: config.API_FOOTBALL_TIMEOUT_MS,
    maxRetries: config.API_FOOTBALL_MAX_RETRIES,
  },
  logger,
);

const toState = (state: {
  status: string;
  minute: number | null;
  homeScore: number;
  awayScore: number;
}): FixtureState => ({
  status: state.status as FixtureState["status"],
  score: { home: state.homeScore, away: state.awayScore },
  ...(state.minute === null ? {} : { minute: state.minute }),
});

await redis.connect();
const worker = new Worker<FixtureChangeJob>(
  QUEUE_NAMES.fixtureChanges,
  async (job) => {
    const processed = await processFixtureDelivery(
      prisma,
      job.data,
      async (payload) => {
        const [previousRecord, currentRecord, fixture] = await Promise.all([
          prisma.fixtureState.findUniqueOrThrow({
            where: { id: payload.previousStateId },
          }),
          prisma.fixtureState.findUniqueOrThrow({
            where: { id: payload.currentStateId },
          }),
          prisma.fixture.findUniqueOrThrow({
            where: { id: payload.fixtureId },
            include: { homeTeam: true, awayTeam: true },
          }),
        ]);
        if (
          previousRecord.fixtureId !== fixture.id ||
          currentRecord.fixtureId !== fixture.id
        ) {
          throw new Error("Outbox snapshot does not belong to its fixture");
        }
        const previous = toState(previousRecord);
        const current = toState(currentRecord);
        const sourceEvents: NormalizedFootballEvent[] = [];
        if (
          current.score.home !== previous.score.home ||
          current.score.away !== previous.score.away
        ) {
          const upstream = await provider.getFixtureEvents(
            fixture.sourceFixtureId,
          );
          const candidates = upstream.filter(
            (event) =>
              event.minute === undefined ||
              event.minute >= (previous.minute ?? 0),
          );
          for (const sourceEvent of candidates) {
            const resolved = await resolveSourceEventIdentities(
              prisma,
              fixture,
              sourceEvent,
            );
            if (resolved.issues.length > 0) {
              logger.warn(
                {
                  fixture_id: fixture.id,
                  source_event_id: sourceEvent.sourceEventId,
                  source_team_id: sourceEvent.sourceTeamId,
                  source_player_id: sourceEvent.sourcePlayerId,
                  identity_issues: resolved.issues,
                },
                "source event has incomplete identity information",
              );
            }
            sourceEvents.push({
              ...resolved.event,
              homeScore: current.score.home,
              awayScore: current.score.away,
            });
          }
        }
        const drafts = detectFixtureEvents(
          fixture.id,
          previous,
          current,
          sourceEvents,
        );
        const prepared: EventDraft[] = [];
        for (const draft of drafts) {
          let enriched = draft;
          if (draft.eventType === "score_correction") {
            const related = await prisma.footballEvent.findFirst({
              where: {
                fixtureId: fixture.id,
                eventType: { in: ["goal", "own_goal", "penalty_goal"] },
              },
              orderBy: { detectedAt: "desc" },
              select: { id: true },
            });
            if (related !== null)
              enriched = { ...draft, relatedEventId: related.id };
          }
          prepared.push(enriched);
        }
        return prepared;
      },
    );
    metrics.increment("events_detected", processed.created);
    metrics.increment("duplicates_ignored", processed.duplicates);
    await redis.set(
      "health:worker:event-processor",
      new Date().toISOString(),
      "EX",
      config.WORKER_HEARTBEAT_TTL_SECONDS,
    );
  },
  { connection: redis, concurrency: 10 },
);

worker.on("failed", (job, error) => {
  metrics.increment("worker_failures");
  logger.error(
    { err: error, fixture_id: job?.data.fixtureId },
    "event processing failed",
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  await worker.close();
  await Promise.all([prisma.$disconnect(), redis.quit()]);
}
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
