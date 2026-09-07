import type { FootballEventType } from "@fcp/football-core";

export interface ContentContext {
  eventType: FootballEventType;
  minute?: number;
  extraTime?: number;
  homeTeam: string;
  homeTeamShort?: string;
  awayTeam: string;
  awayTeamShort?: string;
  homeScore?: number;
  awayScore?: number;
  playerName?: string;
  scoringTeamName?: string;
  competitionSlug: string;
}

export interface GeneratedContent {
  channel: string;
  contentType: "live_alert";
  priority: "breaking" | "high" | "normal";
  shortText: string;
  standardText: string;
}

const labels: Partial<Record<FootballEventType, string>> = {
  goal: "GOAL",
  own_goal: "OWN GOAL",
  penalty_goal: "PENALTY GOAL",
  score_updated: "SCORE UPDATE",
  match_started: "KICK-OFF",
  half_time: "HT",
  second_half_started: "SECOND HALF",
  extra_time_started: "EXTRA TIME",
  penalty_shootout_started: "PENALTIES",
  match_finished: "FT",
  match_postponed: "POSTPONED",
  match_suspended: "SUSPENDED",
  match_abandoned: "ABANDONED",
  match_cancelled: "CANCELLED",
  red_card: "RED CARD",
  penalty_missed: "PENALTY MISSED",
  goal_cancelled: "GOAL CANCELLED",
  score_correction: "SCORE CORRECTION",
};

function minute(context: ContentContext): string {
  return context.minute === undefined
    ? ""
    : ` ${context.minute}${context.extraTime === undefined ? "" : `+${context.extraTime}`}'`;
}

function scoreLine(context: ContentContext, shortNames = false): string {
  const home = shortNames
    ? (context.homeTeamShort ?? context.homeTeam)
    : context.homeTeam;
  const away = shortNames
    ? (context.awayTeamShort ?? context.awayTeam)
    : context.awayTeam;
  return context.homeScore === undefined || context.awayScore === undefined
    ? `${home} v ${away}`
    : `${home} ${context.homeScore}-${context.awayScore} ${away}`;
}

function render(context: ContentContext, shortNames = false): string {
  const score = scoreLine(context, shortNames);
  if (["goal", "own_goal", "penalty_goal"].includes(context.eventType)) {
    const kind =
      context.eventType === "own_goal"
        ? "OWN GOAL"
        : context.eventType === "penalty_goal"
          ? "PENALTY GOAL"
          : "GOAL";
    const scorer =
      context.playerName === undefined ? "" : ` ${context.playerName} scores`;
    return `${kind}!${minute(context)} ${score}.${scorer}`.trim();
  }
  const label =
    labels[context.eventType] ??
    context.eventType.replaceAll("_", " ").toUpperCase();
  const actor = ["red_card", "penalty_missed", "goal_cancelled"].includes(
    context.eventType,
  )
    ? [context.playerName, context.scoringTeamName].filter(Boolean).join(" — ")
    : "";
  return `${label}${minute(context)}: ${score}.${actor === "" ? "" : ` ${actor}.`}`;
}

function compact(context: ContentContext, maxLength: number): string {
  const candidates = [
    render(context, false),
    render(context, true),
    `${labels[context.eventType] ?? "GOAL"}${minute(context)}: ${scoreLine(context, true)}.`,
    `${scoreLine(context, true)} — ${labels[context.eventType] ?? "GOAL"}${minute(context)}.`,
  ];
  const fitting = candidates.find((candidate) => candidate.length <= maxLength);
  if (fitting !== undefined) return fitting;
  throw new RangeError(
    `Content limit ${maxLength} is too small to preserve the event and score`,
  );
}

function priority(eventType: FootballEventType): GeneratedContent["priority"] {
  if (
    [
      "goal",
      "own_goal",
      "penalty_goal",
      "red_card",
      "goal_cancelled",
      "score_correction",
    ].includes(eventType)
  ) {
    return "breaking";
  }
  if (
    [
      "match_finished",
      "match_postponed",
      "match_suspended",
      "match_abandoned",
      "match_cancelled",
    ].includes(eventType)
  ) {
    return "high";
  }
  return "normal";
}

export function generateContent(
  context: ContentContext,
  shortMaxLength: number,
): GeneratedContent {
  return {
    channel: context.competitionSlug,
    contentType: "live_alert",
    priority: priority(context.eventType),
    shortText: compact(context, shortMaxLength),
    standardText: render(context, false),
  };
}
