import type { FixtureState } from "./models.js";

export interface FixtureStateComparison {
  scoreChanged: boolean;
  homeScoreDelta: number;
  awayScoreDelta: number;
  statusChanged: boolean;
  minuteChanged: boolean;
  changed: boolean;
}

export function compareFixtureStates(
  previous: FixtureState | null,
  current: FixtureState,
): FixtureStateComparison {
  if (previous === null) {
    return {
      scoreChanged: false,
      homeScoreDelta: 0,
      awayScoreDelta: 0,
      statusChanged: false,
      minuteChanged: false,
      changed: false,
    };
  }

  const homeScoreDelta = current.score.home - previous.score.home;
  const awayScoreDelta = current.score.away - previous.score.away;
  const scoreChanged = homeScoreDelta !== 0 || awayScoreDelta !== 0;
  const statusChanged = previous.status !== current.status;
  const minuteChanged = previous.minute !== current.minute;

  return {
    scoreChanged,
    homeScoreDelta,
    awayScoreDelta,
    statusChanged,
    minuteChanged,
    changed: scoreChanged || statusChanged,
  };
}
