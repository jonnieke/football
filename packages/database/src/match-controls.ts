import { z } from "zod";
import type { PrismaClient } from "./generated/prisma/client.ts";

export class MatchControlConflict extends Error {}
export const matchControlSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().min(1).max(2147483646),
    enabled: z.boolean(),
  })
  .strict();

export async function listMatchControls(prisma: PrismaClient, date: string) {
  z.iso.date().parse(date);
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86400000);
  // Include live games even when they kicked off on a different date.
  const items = await prisma.fixture.findMany({
    where: {
      source: "api-football",
      competition: { enabled: true },
      OR: [
        { kickoffAt: { gte: start, lt: end } },
        {
          status: {
            in: [
              "first_half",
              "half_time",
              "second_half",
              "extra_time",
              "penalty_shootout",
            ],
          },
        },
      ],
    },
    orderBy: [{ kickoffAt: "asc" }, { id: "asc" }],
    take: 501,
    select: {
      id: true,
      kickoffAt: true,
      status: true,
      minute: true,
      homeScore: true,
      awayScore: true,
      lastPolledAt: true,
      notificationsEnabled: true,
      notificationVersion: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
      competition: { select: { name: true, season: true } },
    },
  });
  return {
    items: items.slice(0, 500),
    truncated: items.length > 500,
    checkedAt: new Date().toISOString(),
  };
}

export function changeMatchControl(
  prisma: PrismaClient,
  input: unknown,
  actor: string,
) {
  const change = matchControlSchema.parse(input);
  z.email().max(254).parse(actor);
  return prisma.$transaction(
    async (tx) => {
      // Same lock as publication: after this commits, a paused game cannot publish.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`match-notifications:${change.id}`}, 0))`;
      const updated = await tx.fixture.updateMany({
        where: {
          id: change.id,
          source: "api-football",
          notificationVersion: change.version,
        },
        data: {
          notificationsEnabled: change.enabled,
          notificationVersion: { increment: 1 },
          notificationChangedAt: new Date(),
          notificationChangedBy: actor,
        },
      });
      if (updated.count !== 1)
        throw new MatchControlConflict(
          "Match settings changed; refresh and try again.",
        );
      return tx.fixture.findUniqueOrThrow({
        where: { id: change.id },
        select: {
          id: true,
          notificationsEnabled: true,
          notificationVersion: true,
        },
      });
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

export function matchAllowsPublication(
  settings: {
    notificationsEnabled: boolean;
    notificationChangedAt: Date | null;
  },
  observedAt: Date | undefined,
) {
  return (
    settings.notificationsEnabled &&
    (settings.notificationChangedAt === null ||
      (observedAt !== undefined &&
        observedAt >= settings.notificationChangedAt))
  );
}
