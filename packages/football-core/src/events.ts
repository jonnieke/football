import { createHash } from "node:crypto";
import type {
  FixtureState,
  FootballEventType,
  NormalizedFootballEvent,
} from "./models.js";
import { compareFixtureStates } from "./state.js";

const statusEvents: Partial<Record<FixtureState["status"], FootballEventType>> =
  {
    first_half: "match_started",
    half_time: "half_time",
    second_half: "second_half_started",
    extra_time: "extra_time_started",
    penalty_shootout: "penalty_shootout_started",
    finished: "match_finished",
    postponed: "match_postponed",
    suspended: "match_suspended",
    abandoned: "match_abandoned",
    cancelled: "match_cancelled",
  };

export type EventDraft = Omit<NormalizedFootballEvent, "sourceEventId"> & {
  sourceEventId?: string;
  relatedEventId?: string;
};

export function detectFixtureEvents(
  fixtureId: string,
  previous: FixtureState | null,
  current: FixtureState,
  sourceEvents: readonly NormalizedFootballEvent[] = [],
  observationId?: string,
): EventDraft[] {
  const comparison = compareFixtureStates(previous, current);
  // Source facts remain relevant when the aggregate score/status is unchanged,
  // including late events. Canonical identity, not a minute cutoff, deduplicates.
  const events: EventDraft[] = [...sourceEvents];
  if (comparison.scoreChanged) {
    // A scoreboard change is not evidence of N individual goals or a scorer.
    // Keep an explicit observation rather than manufacture goal events.
    events.push({
      fixtureId,
      eventType:
        comparison.homeScoreDelta < 0 || comparison.awayScoreDelta < 0
          ? "score_correction"
          : "score_updated",
      ...(observationId === undefined
        ? {}
        : { sourceEventId: `observation:${observationId}:score` }),
      ...(current.minute === undefined ? {} : { minute: current.minute }),
      homeScore: current.score.home,
      awayScore: current.score.away,
    });
  }

  if (comparison.statusChanged || previous === null) {
    const eventType = statusEvents[current.status];
    if (eventType !== undefined) {
      events.push({
        fixtureId,
        eventType,
        ...(observationId === undefined
          ? {}
          : { sourceEventId: `observation:${observationId}:status` }),
        ...(current.minute === undefined ? {} : { minute: current.minute }),
        homeScore: current.score.home,
        awayScore: current.score.away,
      });
    }
  }
  return events;
}

export function createEventFingerprint(event: EventDraft): string {
  if (
    event.sourceEventId?.startsWith("api-football:v2:") ||
    event.sourceEventId?.startsWith("observation:")
  ) {
    return createHash("sha256")
      .update(
        JSON.stringify([event.fixtureId, event.eventType, event.sourceEventId]),
      )
      .digest("hex");
  }
  const canonical = [
    event.fixtureId,
    event.eventType,
    event.minute ?? "",
    event.extraTime ?? "",
    event.teamId ?? "",
    event.playerId ?? "",
    event.sourceEventId ?? "",
    event.homeScore ?? "",
    event.awayScore ?? "",
    event.relatedEventId ?? "",
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
