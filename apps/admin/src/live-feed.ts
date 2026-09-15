import { z } from "zod";
import type { PrismaClient } from "@fcp/database";

// This is an admin-only read position, not an authorization token.
export const liveFeedQuery = z
  .object({
    after: z
      .string()
      .regex(/^[0-9a-f-]{36}:(0|[1-9][0-9]{0,18})$/i)
      .optional(),
  })
  .strict();

export function liveFeedReader(prisma: PrismaClient) {
  return async (after?: string) => {
    liveFeedQuery.parse({ after });
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`;
        const state = await tx.feedPublicationState.findUniqueOrThrow({
          where: { id: 1 },
        });
        const [epoch, sequence] = after?.split(":") ?? [];
        const position = sequence === undefined ? 0n : BigInt(sequence);
        const reset =
          after !== undefined &&
          (epoch !== state.epoch || position > state.highWater);
        const initial = after === undefined || reset;
        const records = await tx.contentItem.findMany({
          where: {
            status: "published",
            publicationSequence: {
              ...(initial ? {} : { gt: position }),
              lte: state.highWater,
            },
          },
          orderBy: { publicationSequence: initial ? "desc" : "asc" },
          take: 50,
          select: {
            id: true,
            publicationSequence: true,
            shortText: true,
            publishedAt: true,
            event: {
              select: {
                eventType: true,
                minute: true,
                fixture: {
                  select: {
                    kickoffAt: true,
                    homeTeam: { select: { name: true } },
                    awayTeam: { select: { name: true } },
                    competition: { select: { name: true, season: true } },
                  },
                },
              },
            },
          },
        });
        const next =
          initial || records.length < 50
            ? state.highWater
            : records.at(-1)!.publicationSequence!;
        if (initial) records.reverse();
        return {
          items: records.map(({ publicationSequence, event, ...item }) => ({
            ...item,
            sequence: publicationSequence!.toString(),
            minute: event.minute,
            eventType: event.eventType,
            match: `${event.fixture.homeTeam.name} v ${event.fixture.awayTeam.name}`,
            league: event.fixture.competition.name,
            season: event.fixture.competition.season,
            kickoffAt: event.fixture.kickoffAt,
          })),
          cursor: `${state.epoch}:${next}`,
          reset,
          more: next < state.highWater,
          checkedAt: new Date().toISOString(),
        };
      },
      { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 7000 },
    );
  };
}
