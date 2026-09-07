import type {
  NormalizedCompetition,
  NormalizedFixture,
  NormalizedSourceEvent,
} from "@fcp/football-core";

export interface FootballProvider {
  getLiveFixtures(): Promise<NormalizedFixture[]>;
  getFixture(fixtureId: string): Promise<NormalizedFixture | null>;
  getFixtureEvents(fixtureId: string): Promise<NormalizedSourceEvent[]>;
  getCompetitions(): Promise<NormalizedCompetition[]>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
}
