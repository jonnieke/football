import { z } from "zod";
import {
  detectFixtureEvents,
  FOOTBALL_EVENT_TYPES,
  type FixtureState,
  type NormalizedFootballEvent,
  type NormalizedSourceEvent,
} from "@fcp/football-core";
import type { FixtureChangeJob } from "@fcp/shared";
import type { PrismaClient } from "./generated/prisma/client.ts";
import { resolveSourceEventIdentities } from "./event-identities.js";

const sourceSchema = z.array(
  z.object({
    source: z.enum(["api-football", "synthetic"]),
    sourceFixtureId: z.string(),
    sourceEventId: z.string().min(1),
    eventType: z.enum(FOOTBALL_EVENT_TYPES),
    minute: z.number().int().nonnegative().optional(),
    extraTime: z.number().int().nonnegative().optional(),
    sourceTeamId: z.string().optional(),
    sourcePlayerId: z.string().optional(),
    playerName: z.string().optional(),
  }),
);

const state = (record: {
  status: string;
  minute: number | null;
  homeScore: number;
  awayScore: number;
}): FixtureState => ({
  status: record.status as FixtureState["status"],
  score: { home: record.homeScore, away: record.awayScore },
  ...(record.minute === null ? {} : { minute: record.minute }),
});

/** No provider I/O: all event facts come from the exact committed observation. */
export async function prepareFixtureObservation(
  prisma: PrismaClient,
  payload: Omit<FixtureChangeJob, "outboxId">,
) {
  const [previous, current, fixture] = await Promise.all([
    prisma.fixtureState.findUniqueOrThrow({
      where: { id: payload.previousStateId },
    }),
    prisma.fixtureState.findUniqueOrThrow({
      where: { id: payload.currentStateId },
    }),
    prisma.fixture.findUniqueOrThrow({
      where: { id: payload.fixtureId },
      include: { homeTeam: true, awayTeam: true },
    }),
  ]);
  if (previous.fixtureId !== fixture.id || current.fixtureId !== fixture.id)
    throw new Error("Outbox snapshot does not belong to its fixture");
  if (current.sourceEvents === null)
    throw new Error(
      "Legacy snapshot has no source observation; drain legacy work before upgrade or explicitly pause it",
    );
  const sources = sourceSchema.parse(current.sourceEvents);
  const events: NormalizedFootballEvent[] = [];
  for (const source of sources) {
    const input = Object.fromEntries(
      Object.entries(source).filter(([, value]) => value !== undefined),
    ) as unknown as NormalizedSourceEvent;
    const resolved = await resolveSourceEventIdentities(prisma, fixture, input);
    if (resolved.issues.includes("UNKNOWN_SOURCE_TEAM"))
      throw new Error("Source observation contains a team outside its fixture");
    events.push(resolved.event);
  }
  // Never guess which historical goal a score correction or VAR decision undid.
  return detectFixtureEvents(
    fixture.id,
    previous.id === current.id ? null : state(previous),
    state(current),
    events,
    current.id,
  );
}
