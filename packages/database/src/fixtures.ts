import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "./generated/prisma/client.ts";
import {
  compareFixtureStates,
  type FixtureState,
  type NormalizedFixture,
} from "@fcp/football-core";
import { v7 as uuidv7 } from "uuid";
import { ensureFixtureWork } from "./outbox.js";

export interface PersistFixtureResult {
  fixtureId: string;
  previousStateId?: string;
  currentStateId: string;
  changed: boolean;
}

function stateHash(state: FixtureState): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        state.status,
        state.minute ?? null,
        state.score.home,
        state.score.away,
      ]),
    )
    .digest("hex");
}

export async function persistNormalizedFixture(
  prisma: PrismaClient,
  input: NormalizedFixture,
): Promise<PersistFixtureResult> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const competition = await tx.competition.upsert({
      where: {
        source_sourceId_season: {
          source: input.source,
          sourceId: input.competition.sourceId,
          season: input.competition.season,
        },
      },
      create: {
        id: uuidv7(),
        source: input.source,
        sourceId: input.competition.sourceId,
        name: input.competition.name,
        slug: input.competition.slug,
        country: input.competition.country ?? null,
        season: input.competition.season,
      },
      update: {
        name: input.competition.name,
        slug: input.competition.slug,
        country: input.competition.country ?? null,
      },
    });
    const upsertTeam = async (team: NormalizedFixture["homeTeam"]) =>
      tx.team.upsert({
        where: {
          source_sourceId: { source: input.source, sourceId: team.sourceId },
        },
        create: {
          id: uuidv7(),
          source: input.source,
          sourceId: team.sourceId,
          name: team.name,
          shortName: team.shortName ?? null,
          country: team.country ?? null,
        },
        update: {
          name: team.name,
          shortName: team.shortName ?? null,
          country: team.country ?? null,
        },
      });
    const [homeTeam, awayTeam] = await Promise.all([
      upsertTeam(input.homeTeam),
      upsertTeam(input.awayTeam),
    ]);
    const existing = await tx.fixture.findUnique({
      where: {
        source_sourceFixtureId: {
          source: input.source,
          sourceFixtureId: input.sourceFixtureId,
        },
      },
      include: { states: { orderBy: { capturedAt: "desc" }, take: 1 } },
    });
    const previousState = existing?.states[0];
    const currentState: FixtureState = {
      status: input.status,
      score: input.score,
      ...(input.minute === undefined ? {} : { minute: input.minute }),
    };
    const previous: FixtureState | null =
      previousState === undefined
        ? null
        : {
            status: previousState.status as FixtureState["status"],
            score: {
              home: previousState.homeScore,
              away: previousState.awayScore,
            },
            ...(previousState.minute === null
              ? {}
              : { minute: previousState.minute }),
          };
    const comparison = compareFixtureStates(previous, currentState);
    const fixture = await tx.fixture.upsert({
      where: {
        source_sourceFixtureId: {
          source: input.source,
          sourceFixtureId: input.sourceFixtureId,
        },
      },
      create: {
        id: uuidv7(),
        source: input.source,
        sourceFixtureId: input.sourceFixtureId,
        competitionId: competition.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt: input.kickoffAt,
        status: input.status,
        minute: input.minute ?? null,
        homeScore: input.score.home,
        awayScore: input.score.away,
        lastSourceUpdateAt: input.sourceUpdatedAt ?? null,
        lastPolledAt: input.receivedAt,
      },
      update: {
        competitionId: competition.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt: input.kickoffAt,
        status: input.status,
        minute: input.minute ?? null,
        homeScore: input.score.home,
        awayScore: input.score.away,
        lastSourceUpdateAt: input.sourceUpdatedAt ?? null,
        lastPolledAt: input.receivedAt,
      },
    });
    const hash = stateHash(currentState);
    if (previousState !== undefined && previousState.rawHash === hash) {
      return {
        fixtureId: fixture.id,
        previousStateId: previousState.id,
        currentStateId: previousState.id,
        changed: false,
      };
    }
    const snapshot = await tx.fixtureState.create({
      data: {
        id: uuidv7(),
        fixtureId: fixture.id,
        status: input.status,
        minute: input.minute ?? null,
        homeScore: input.score.home,
        awayScore: input.score.away,
        rawHash: hash,
        capturedAt: input.receivedAt,
      },
    });
    if (previousState !== undefined && comparison.changed) {
      await ensureFixtureWork(tx, {
        fixtureId: fixture.id,
        previousStateId: previousState.id,
        currentStateId: snapshot.id,
      });
    }
    return {
      fixtureId: fixture.id,
      ...(previousState === undefined
        ? {}
        : { previousStateId: previousState.id }),
      currentStateId: snapshot.id,
      changed: existing !== null && comparison.changed,
    };
  });
}
