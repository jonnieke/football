import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "./generated/prisma/client.ts";
import {
  compareFixtureStates,
  type FixtureState,
  type NormalizedFixture,
  type NormalizedSourceEvent,
} from "@fcp/football-core";
import { v7 as uuidv7 } from "uuid";
import { ensureFixtureWork } from "./outbox.js";

export interface PersistFixtureResult {
  fixtureId: string;
  previousStateId?: string;
  currentStateId: string;
  changed: boolean;
}

function canonicalEvents(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((event: unknown) => {
      if (event === null || typeof event !== "object")
        throw new Error("Invalid source observation");
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(event).sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
    })
    .sort()
    .join("\n");
}

function stateHash(
  state: FixtureState,
  events?: readonly NormalizedSourceEvent[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        state.status,
        state.minute ?? null,
        state.score.home,
        state.score.away,
        canonicalEvents(events),
      ]),
    )
    .digest("hex");
}

export async function persistNormalizedFixture(
  prisma: PrismaClient,
  input: NormalizedFixture,
  sourceEvents?: readonly NormalizedSourceEvent[],
): Promise<PersistFixtureResult> {
  if (
    sourceEvents?.some(
      (event) =>
        event.source !== input.source ||
        event.sourceFixtureId !== input.sourceFixtureId,
    )
  ) {
    throw new Error("Source events do not belong to the fixture observation");
  }
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Serialize writers for the same source fixture, including first insertion.
    // Hash collisions only cause extra serialization, not incorrect ownership.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.source}:${input.sourceFixtureId}`}, 0))`;
    const existing = await tx.fixture.findUnique({
      where: {
        source_sourceFixtureId: {
          source: input.source,
          sourceFixtureId: input.sourceFixtureId,
        },
      },
      include: {
        states: { orderBy: [{ capturedAt: "desc" }, { id: "desc" }], take: 1 },
      },
    });
    const previousState = existing?.states[0];
    if (
      existing?.lastPolledAt !== null &&
      existing?.lastPolledAt !== undefined &&
      existing.lastPolledAt >= input.receivedAt &&
      previousState !== undefined
    ) {
      return {
        fixtureId: existing.id,
        previousStateId: previousState.id,
        currentStateId: previousState.id,
        changed: false,
      };
    }
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
    const hash = stateHash(currentState, sourceEvents);
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
        ...(sourceEvents === undefined
          ? {}
          : {
              sourceEvents: JSON.parse(
                JSON.stringify(sourceEvents),
              ) as Prisma.InputJsonValue,
            }),
        capturedAt: input.receivedAt,
      },
    });
    const eventsChanged =
      sourceEvents !== undefined &&
      canonicalEvents(previousState?.sourceEvents) !==
        canonicalEvents(sourceEvents);
    const changed = comparison.changed || eventsChanged;
    if (
      changed &&
      (previousState !== undefined || sourceEvents !== undefined)
    ) {
      await ensureFixtureWork(tx, {
        fixtureId: fixture.id,
        previousStateId: previousState?.id ?? snapshot.id,
        currentStateId: snapshot.id,
      });
    }
    return {
      fixtureId: fixture.id,
      ...(previousState === undefined
        ? {}
        : { previousStateId: previousState.id }),
      currentStateId: snapshot.id,
      changed,
    };
  });
}
