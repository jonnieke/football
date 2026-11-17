import type { NormalizedFixture } from "@fcp/football-core";
import type { FootballProvider } from "@fcp/football-provider";

export interface EnabledCompetition {
  sourceId: string;
  season: number;
}

/** Empty configuration is fail-closed. Dates are UTC, including midnight overlap. */
export async function collectFixtures(
  provider: Pick<
    FootballProvider,
    "getLiveFixtures" | "getFixturesByDate" | "getFixture"
  >,
  enabled: readonly EnabledCompetition[],
  trackedIds: readonly string[],
  discover: boolean,
  now = new Date(),
  daysAhead = 7,
): Promise<NormalizedFixture[]> {
  if (enabled.length === 0) return [];
  const allowed = new Set(
    enabled.map((item) => `${item.sourceId}:${item.season}`),
  );
  const selected = new Map<string, NormalizedFixture>();
  const accept = (fixture: NormalizedFixture) => {
    if (
      !allowed.has(
        `${fixture.competition.sourceId}:${fixture.competition.season}`,
      )
    )
      return;
    const prior = selected.get(fixture.sourceFixtureId);
    if (prior === undefined || prior.receivedAt < fixture.receivedAt)
      selected.set(fixture.sourceFixtureId, fixture);
  };
  const live = await provider.getLiveFixtures();
  live.forEach(accept);
  if (discover) {
    const offsets: number[] = [-1, 0];
    for (let i = 1; i <= daysAhead; i += 1) {
      offsets.push(i);
    }
    for (const offset of offsets) {
      const date = new Date(now.getTime() + offset * 86_400_000)
        .toISOString()
        .slice(0, 10);
      (await provider.getFixturesByDate(date)).forEach(accept);
    }
  }
  // Disappearance from live=all is not a terminal state. Ask for the fixture.
  for (const id of new Set(trackedIds)) {
    if (selected.has(id)) continue;
    const fixture = await provider.getFixture(id);
    if (fixture !== null) accept(fixture);
  }
  return [...selected.values()];
}
