import type {
  NormalizedFootballEvent,
  NormalizedSourceEvent,
} from "@fcp/football-core";
import { validate as isUuid, v7 as uuidv7 } from "uuid";

interface PlayerKey {
  source_sourceId: { source: string; sourceId: string };
}
interface PlayerLookup {
  where: PlayerKey;
  select: { id: true };
}
interface IdentityStore {
  player: {
    upsert(
      args: PlayerLookup & {
        create: { id: string; source: string; sourceId: string; name: string };
        update: { name?: string };
      },
    ): Promise<{ id: string }>;
    findUnique(args: PlayerLookup): Promise<{ id: string } | null>;
  };
}

export interface IdentityFixture {
  id: string;
  source: string;
  sourceFixtureId: string;
  homeTeam: { id: string; source: string; sourceId: string };
  awayTeam: { id: string; source: string; sourceId: string };
}

export type IdentityIssue =
  | "UNKNOWN_SOURCE_TEAM"
  | "PLAYER_ID_MISSING"
  | "PLAYER_NAME_MISSING";

export function assertInternalEventIds(
  event: Pick<NormalizedFootballEvent, "fixtureId" | "teamId" | "playerId"> & {
    relatedEventId?: string;
  },
): void {
  for (const field of [
    "fixtureId",
    "teamId",
    "playerId",
    "relatedEventId",
  ] as const) {
    const value = event[field];
    if (
      (field === "fixtureId" || value !== undefined) &&
      !isUuid(value ?? "")
    ) {
      throw new Error(`Canonical event requires an internal UUID for ${field}`);
    }
  }
}

export async function resolveSourceEventIdentities(
  store: IdentityStore,
  fixture: IdentityFixture,
  input: NormalizedSourceEvent,
): Promise<{ event: NormalizedFootballEvent; issues: IdentityIssue[] }> {
  if (
    input.source !== fixture.source ||
    input.sourceFixtureId !== fixture.sourceFixtureId
  ) {
    throw new Error("Source event does not belong to the supplied fixture");
  }
  if (
    fixture.homeTeam.source !== fixture.source ||
    fixture.awayTeam.source !== fixture.source
  ) {
    throw new Error("Fixture teams belong to a different provider");
  }
  assertInternalEventIds({
    fixtureId: fixture.id,
    teamId: fixture.homeTeam.id,
  });
  assertInternalEventIds({
    fixtureId: fixture.id,
    teamId: fixture.awayTeam.id,
  });
  const issues: IdentityIssue[] = [];
  const { source, sourceTeamId, sourcePlayerId, playerName } = input;
  const team = [fixture.homeTeam, fixture.awayTeam].find(
    (candidate) => candidate.sourceId === sourceTeamId,
  );
  if (sourceTeamId !== undefined && team === undefined)
    issues.push("UNKNOWN_SOURCE_TEAM");
  const name = playerName?.trim() || undefined;
  let playerId: string | undefined;
  if (sourcePlayerId !== undefined) {
    if (sourcePlayerId.trim().length === 0)
      throw new Error("Source player ID must not be blank");
    if (name === undefined) issues.push("PLAYER_NAME_MISSING");
    const lookup: PlayerLookup = {
      where: { source_sourceId: { source, sourceId: sourcePlayerId } },
      select: { id: true },
    };
    try {
      const player = await store.player.upsert({
        ...lookup,
        create: {
          id: uuidv7(),
          source,
          sourceId: sourcePlayerId,
          name: name ?? "Unknown player",
        },
        // An event is not evidence of a player's current roster membership.
        // Missing names must not overwrite an existing known name either.
        update: name === undefined ? {} : { name },
      });
      playerId = player.id;
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "P2002"
      )
        throw error;
      // Covers clients which cannot delegate this upsert to PostgreSQL.
      const winner = await store.player.findUnique(lookup);
      if (winner === null) throw error;
      playerId = winner.id;
    }
  } else if (name !== undefined) issues.push("PLAYER_ID_MISSING");

  const event: NormalizedFootballEvent = {
    // Allowlist domain facts: never carry unexpected raw identity fields through.
    eventType: input.eventType,
    ...(input.sourceEventId === undefined
      ? {}
      : { sourceEventId: input.sourceEventId }),
    ...(input.minute === undefined ? {} : { minute: input.minute }),
    ...(input.extraTime === undefined ? {} : { extraTime: input.extraTime }),
    ...(input.homeScore === undefined ? {} : { homeScore: input.homeScore }),
    ...(input.awayScore === undefined ? {} : { awayScore: input.awayScore }),
    ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    fixtureId: fixture.id,
    ...(team === undefined ? {} : { teamId: team.id }),
    ...(playerId === undefined ? {} : { playerId }),
    ...(name === undefined ? {} : { playerName: name }),
  };
  assertInternalEventIds(event);
  return { event, issues };
}
