export const FIXTURE_STATUSES = [
  "scheduled",
  "pre_match",
  "first_half",
  "half_time",
  "second_half",
  "extra_time",
  "penalty_shootout",
  "finished",
  "postponed",
  "suspended",
  "abandoned",
  "cancelled",
  "unknown",
] as const;

export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

export const FOOTBALL_EVENT_TYPES = [
  "match_started",
  "goal",
  "own_goal",
  "penalty_goal",
  "penalty_missed",
  "goal_cancelled",
  "red_card",
  "half_time",
  "second_half_started",
  "extra_time_started",
  "penalty_shootout_started",
  "match_finished",
  "match_postponed",
  "match_suspended",
  "match_abandoned",
  "match_cancelled",
  "score_correction",
  "score_updated",
] as const;

export type FootballEventType = (typeof FOOTBALL_EVENT_TYPES)[number];
export type ProviderSource = "api-football" | "synthetic";

export interface NormalizedCompetition {
  id: string;
  source: ProviderSource;
  sourceId: string;
  name: string;
  slug: string;
  country?: string;
  season: number;
}

export interface NormalizedTeam {
  id: string;
  source: ProviderSource;
  sourceId: string;
  name: string;
  shortName?: string;
  country?: string;
}

export interface NormalizedPlayer {
  id: string;
  source: ProviderSource;
  sourceId: string;
  name: string;
  teamId?: string;
}

export interface FixtureScore {
  home: number;
  away: number;
}

export interface FixtureState {
  status: FixtureStatus;
  score: FixtureScore;
  minute?: number;
}

export interface NormalizedFixture extends FixtureState {
  id: string;
  source: ProviderSource;
  sourceFixtureId: string;
  competition: NormalizedCompetition;
  homeTeam: NormalizedTeam;
  awayTeam: NormalizedTeam;
  kickoffAt: Date;
  sourceUpdatedAt?: Date;
  receivedAt: Date;
}

/** Domain event: fixtureId, teamId, and playerId are internal database UUIDs. */
export interface NormalizedFootballEvent {
  sourceEventId?: string;
  fixtureId: string;
  eventType: FootballEventType;
  minute?: number;
  extraTime?: number;
  teamId?: string;
  playerId?: string;
  playerName?: string;
  homeScore?: number;
  awayScore?: number;
  occurredAt?: Date;
}

/** Provider-scoped identities must be resolved before canonical persistence. */
export interface NormalizedSourceEvent
  extends Omit<NormalizedFootballEvent, "fixtureId" | "teamId" | "playerId"> {
  source: ProviderSource;
  sourceFixtureId: string;
  sourceTeamId?: string;
  sourcePlayerId?: string;
}

export interface FootballEvent extends NormalizedFootballEvent {
  id: string;
  eventFingerprint: string;
  relatedEventId?: string;
  status: "confirmed" | "corrected";
  detectedAt: Date;
  createdAt: Date;
}

export interface ContentItem {
  id: string;
  eventId: string;
  channel: string;
  contentType: "live_alert";
  priority: "breaking" | "high" | "normal";
  shortText: string;
  standardText: string;
  status: "published" | "withdrawn";
  createdAt: Date;
  publishedAt?: Date;
}

export interface PartnerApiClient {
  id: string;
  name: string;
  slug: string;
  status: "enabled" | "disabled" | "revoked";
  rateLimit: number;
}

export interface Cursor {
  publishedAt: string;
  id: string;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  services: {
    database: "healthy" | "unhealthy";
    redis: "healthy" | "unhealthy";
    footballProvider: "healthy" | "degraded" | "unhealthy";
    ingestionWorker: "healthy" | "unhealthy";
    outboxWorker: "healthy" | "unhealthy";
  };
}
