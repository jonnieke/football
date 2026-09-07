import { describe, expect, it, vi } from "vitest";
import { createCursor, parseCursor } from "@fcp/shared";
import { FeedRepository } from "./feed.js";

const epoch = "0198f0cc-1b80-7000-8000-000000000001";
const secret = "test-secret-for-feed-cursor-signatures";
function harness(highWater = 12n) {
  const store = {
    feedPublicationState: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ epoch, highWater }),
    },
    contentItem: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    store,
    feed: new FeedRepository(
      store as unknown as ConstructorParameters<typeof FeedRepository>[0],
      secret,
    ),
  };
}
describe("bounded commit-ordered feed", () => {
  it("issues a resumable zero cursor for an initially empty feed", async () => {
    const { feed } = harness(0n);
    const result = await feed.getFeed({ limit: 10 });
    expect(result.items).toEqual([]);
    expect(parseCursor(result.nextCursor, secret)).toEqual({
      epoch,
      sequence: "0",
      channel: null,
      eventType: null,
    });
  });
  it("advances a filtered empty page to the committed upper bound and preserves it on repeat", async () => {
    const { feed, store } = harness();
    const first = await feed.getFeed({ limit: 10, channel: "epl" });
    expect(parseCursor(first.nextCursor, secret).sequence).toBe("12");
    const second = await feed.getFeed({
      limit: 10,
      channel: "epl",
      after: first.nextCursor,
    });
    expect(second.nextCursor).toBe(first.nextCursor);
    expect(store.contentItem.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          status: "published",
          channel: "epl",
          publicationSequence: { gt: 12n, lte: 12n },
        },
      }),
    );
  });
  it("stops at the last returned position for a full page, without losing bigint precision", async () => {
    const { feed, store } = harness(9007199254740999n);
    store.contentItem.findMany.mockResolvedValue([
      {
        id: "item",
        eventId: "event",
        publicationSequence: 9007199254740993n,
        publishedAt: new Date("2026-09-07T00:00:00Z"),
      },
    ]);
    const result = await feed.getFeed({ limit: 1 });
    expect(parseCursor(result.nextCursor, secret).sequence).toBe(
      "9007199254740993",
    );
    expect(result.items[0]).toMatchObject({
      publication_sequence: "9007199254740993",
    });
  });
  it("rejects filter changes but permits changing page size", async () => {
    const { feed } = harness();
    const after = createCursor(
      { epoch, sequence: "0", channel: "epl", eventType: "goal" },
      secret,
    );
    await expect(
      feed.getFeed({ after, limit: 5, channel: "epl" }),
    ).rejects.toMatchObject({ code: "CURSOR_SCOPE_MISMATCH" });
    await expect(
      feed.getFeed({ after, limit: 50, channel: "epl", eventType: "goal" }),
    ).resolves.toHaveProperty("nextCursor");
  });
  it("rejects a restored-history epoch or a cursor ahead of the database", async () => {
    const { feed } = harness();
    for (const cursor of [
      { epoch: "0198f0cc-1b80-7000-8000-000000000002", sequence: "1" },
      { epoch, sequence: "13" },
    ]) {
      await expect(
        feed.getFeed({
          limit: 10,
          after: createCursor(
            { ...cursor, channel: null, eventType: null },
            secret,
          ),
        }),
      ).rejects.toMatchObject({
        code: "CURSOR_RESET_REQUIRED",
        statusCode: 409,
      });
    }
  });
  it("rejects malformed cursors and invalid limits before querying the database", async () => {
    const { feed, store } = harness();
    await expect(
      feed.getFeed({ after: "invalid", limit: 10 }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(feed.getFeed({ limit: 0 })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(store.feedPublicationState.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
