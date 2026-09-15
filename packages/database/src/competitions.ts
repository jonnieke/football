import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "./generated/prisma/client.ts";

export const competitionChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add"),
      sourceId: z.string().regex(/^[1-9][0-9]{0,8}$/),
      season: z.number().int().min(2000).max(2100),
      name: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      action: z.literal("set-enabled"),
      id: z.uuid(),
      version: z.number().int().min(1).max(2147483646),
      enabled: z.boolean(),
    })
    .strict(),
]);
export class CompetitionConflict extends Error {}
const select = {
  id: true,
  source: true,
  sourceId: true,
  name: true,
  season: true,
  enabled: true,
  coverageVersion: true,
} as const;

export function listCompetitions(prisma: PrismaClient, after?: string) {
  if (after !== undefined) z.uuid().parse(after);
  return prisma.competition.findMany({
    where: { source: "api-football", ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" },
    take: 100,
    select,
  });
}

/** Actor must come from the approved administrator session, never the body. */
export async function changeCompetition(
  prisma: PrismaClient,
  input: unknown,
  actor: string,
) {
  const change = competitionChangeSchema.parse(input);
  z.string().trim().min(1).max(254).parse(actor);
  try {
    return await prisma.$transaction(
      async (tx) => {
        if (change.action === "add") {
          // Register the season separately; never repurpose a row owning fixtures.
          const after = await tx.competition.create({
            data: {
              id: randomUUID(),
              source: "api-football",
              sourceId: change.sourceId,
              season: change.season,
              name: change.name,
              slug: `api-football-${change.sourceId}`,
              enabled: false,
            },
            select,
          });
          await tx.competitionAudit.create({
            data: {
              id: randomUUID(),
              competitionId: after.id,
              actor,
              action: "add",
              before: Prisma.DbNull,
              after,
            },
          });
          return after;
        }
        // Shared with automatic publication; no network calls while held.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`coverage:${change.id}`}, 0))`;
        const before = await tx.competition.findUnique({
          where: { id: change.id },
          select,
        });
        if (
          !before ||
          before.source !== "api-football" ||
          before.coverageVersion !== change.version
        )
          throw new CompetitionConflict(
            "League settings changed; reload before editing.",
          );
        const updated = await tx.competition.updateMany({
          where: { id: change.id, coverageVersion: change.version },
          data: { enabled: change.enabled, coverageVersion: { increment: 1 } },
        });
        if (updated.count !== 1)
          throw new CompetitionConflict(
            "League settings changed; reload before editing.",
          );
        const after = await tx.competition.findUniqueOrThrow({
          where: { id: change.id },
          select,
        });
        await tx.competitionAudit.create({
          data: {
            id: randomUUID(),
            competitionId: change.id,
            actor,
            action: change.enabled ? "enable" : "pause",
            before,
            after,
          },
        });
        return after;
      },
      { maxWait: 5000, timeout: 10000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new CompetitionConflict(
        "That league and season already exist. Reload the list.",
      );
    throw error;
  }
}

export function competitionHistory(prisma: PrismaClient) {
  return prisma.competitionAudit.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      actor: true,
      action: true,
      before: true,
      after: true,
      createdAt: true,
    },
  });
}
