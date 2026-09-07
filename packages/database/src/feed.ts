import { AppError, createCursor, parseCursor } from "@fcp/shared";
import type { PrismaClient } from "./generated/prisma/client.ts";

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
  ): Promise<{ items: unknown[]; nextCursor: string }> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500)
      throw new AppError(
        "INVALID_REQUEST",
        "Feed limit must be between 1 and 500.",
        400,
      );
    const cursor =
      query.after === undefined
        ? undefined
        : parseCursor(query.after, this.cursorSecret);
    const scope = {
      channel: query.channel ?? null,
      eventType: query.eventType ?? null,
    };
    if (
      cursor !== undefined &&
      (cursor.channel !== scope.channel || cursor.eventType !== scope.eventType)
    ) {
      throw new AppError(
        "CURSOR_SCOPE_MISMATCH",
        "Keep the cursor's channel and event_type filters, or restart without after.",
        400,
      );
    }
    // Read the committed upper bound FIRST. The transactional counter prevents
    // any as-yet-uncommitted publication at or below this position.
    const state = await this.prisma.feedPublicationState.findUniqueOrThrow({
      where: { id: 1 },
    });
    const after = cursor === undefined ? 0n : BigInt(cursor.sequence);
    if (
      cursor !== undefined &&
      (cursor.epoch !== state.epoch || after > state.highWater)
    ) {
      throw new AppError(
        "CURSOR_RESET_REQUIRED",
        "The feed cursor no longer belongs to this publication history. Restart without after and deduplicate by content ID.",
        409,
      );
    }
    const records = await this.prisma.contentItem.findMany({
      where: {
        status: "published",
        publicationSequence: { gt: after, lte: state.highWater },
        ...(query.channel === undefined ? {} : { channel: query.channel }),
        ...(query.eventType === undefined
          ? {}
          : { eventType: query.eventType }),
      },
      orderBy: { publicationSequence: "asc" },
      take: query.limit,
    });
    const items = records.map((item) => ({
      id: item.id,
      event_id: item.eventId,
      channel: item.channel,
      content_type: item.contentType,
      event_type: item.eventType,
      priority: item.priority,
      text: { short: item.shortText, standard: item.standardText },
      published_at: item.publishedAt?.toISOString(),
      publication_sequence: item.publicationSequence!.toString(),
    }));
    // A short/empty page scanned the entire bounded, filtered range. Advancing
    // to its high-water mark avoids rescanning unrelated channels on every poll.
    const position =
      records.length < query.limit
        ? state.highWater
        : records.at(-1)!.publicationSequence!;
    return {
      items,
      nextCursor: createCursor(
        { epoch: state.epoch, sequence: position.toString(), ...scope },
        this.cursorSecret,
      ),
    };
  }
}
