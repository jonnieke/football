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
  previous: FixtureState,
  current: FixtureState,
  sourceEvents: readonly NormalizedFootballEvent[] = [],
): EventDraft[] {
  const comparison = compareFixtureStates(previous, current);
  if (!comparison.changed) return [];

  const events: EventDraft[] = [];
  if (comparison.homeScoreDelta < 0 || comparison.awayScoreDelta < 0) {
    events.push({
      fixtureId,
      eventType: "score_correction",
      ...(current.minute === undefined ? {} : { minute: current.minute }),
      homeScore: current.score.home,
      awayScore: current.score.away,
    });
  } else if (comparison.scoreChanged) {
    const newSourceEvents = sourceEvents.filter((event) => {
      if (!["goal", "own_goal", "penalty_goal"].includes(event.eventType))
        return false;
      return (
        event.homeScore === current.score.home &&
        event.awayScore === current.score.away
      );
    });
    if (newSourceEvents.length > 0) {
      events.push(...newSourceEvents);
    } else {
      const totalGoals = comparison.homeScoreDelta + comparison.awayScoreDelta;
      for (let index = 0; index < totalGoals; index += 1) {
        events.push({
          fixtureId,
          eventType: "goal",
          sourceEventId: `state:${current.score.home}-${current.score.away}:${index + 1}-of-${totalGoals}`,
          ...(current.minute === undefined ? {} : { minute: current.minute }),
          homeScore: current.score.home,
          awayScore: current.score.away,
        });
      }
    }
  }

  if (comparison.statusChanged) {
    const eventType = statusEvents[current.status];
    if (eventType !== undefined) {
      events.push({
        fixtureId,
        eventType,
        ...(current.minute === undefined ? {} : { minute: current.minute }),
        homeScore: current.score.home,
        awayScore: current.score.away,
      });
    }
  }
  return events;
}

export function createEventFingerprint(event: EventDraft): string {
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
