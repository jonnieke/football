import type { Prisma, PrismaClient } from "./generated/prisma/client.ts";
import { createCursor, parseCursor } from "@fcp/shared";

export interface FeedQuery {
  after?: string;
  limit: number;
  channel?: string;
  eventType?: string;
}

export class FeedRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly cursorSecret: string,
  ) {}

  public async getFeed(
    query: FeedQuery,
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const cursor =
      query.after === undefined
        ? undefined
        : parseCursor(query.after, this.cursorSecret);
    const where: Prisma.ContentItemWhereInput = {
      status: "published",
      publishedAt: { not: null },
      ...(query.channel === undefined ? {} : { channel: query.channel }),
      ...(query.eventType === undefined
        ? {}
        : { event: { eventType: query.eventType } }),
      ...(cursor === undefined
        ? {}
        : {
            OR: [
              { publishedAt: { gt: new Date(cursor.publishedAt) } },
              {
                publishedAt: new Date(cursor.publishedAt),
                id: { gt: cursor.id },
              },
            ],
          }),
    };
    const records = await this.prisma.contentItem.findMany({
      where,
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      take: query.limit,
      include: {
        event: {
          select: {
            id: true,
            eventType: true,
            fixture: { select: { competitionId: true } },
          },
        },
      },
    });
    const items = records.map((item) => ({
      id: item.id,
      event_id: item.event.id,
      channel: item.channel,
      content_type: item.contentType,
      event_type: item.event.eventType,
      priority: item.priority,
      text: { short: item.shortText, standard: item.standardText },
      published_at: item.publishedAt?.toISOString(),
    }));
    const last = records.at(-1);
    const nextCursor =
      last?.publishedAt === null || last?.publishedAt === undefined
        ? null
        : createCursor(
            { publishedAt: last.publishedAt.toISOString(), id: last.id },
            this.cursorSecret,
          );
    return { items, nextCursor };
  }
}
