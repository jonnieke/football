import { describe, expect, it, vi } from "vitest";
import { AppError } from "@fcp/shared";
import {
  acquireStreamLease,
  bounded,
  createFeedStream,
  resumeCursor,
  sseFrame,
  streamQuerySchema,
} from "./feed-stream.js";

describe("live feed protocol", () => {
  it("rejects conflicting positions and credentials in the query", () => {
    expect(resumeCursor("a", "a")).toBe("a");
    expect(resumeCursor(undefined, "b")).toBe("b");
    expect(() => resumeCursor("a", "b")).toThrow("conflicting");
    expect(() => resumeCursor(undefined, ["a"])).toThrow();
    expect(() => streamQuerySchema.parse({ token: "secret" })).toThrow();
  });
  it("escapes data and rejects frame injection", () => {
    expect(sseFrame("feed", { text: "goal\n\nevent: fake" }, "position")).toBe(
      'id: position\nevent: feed\ndata: {"text":"goal\\n\\nevent: fake"}\n\n',
    );
    expect(() => sseFrame("feed", {}, "x\nid: fake")).toThrow();
  });
  it("emits ordered batches, advances filtered checkpoints, and rotates", async () => {
    const getFeed = vi.fn().mockResolvedValue({ items: [], nextCursor: "c" });
    const stream = createFeedStream({
      feed: { getFeed },
      cursor: "a",
      first: { items: [{ id: "one" }], nextCursor: "b" },
      scope: { channel: "web" },
      stillAuthorized: () => Promise.resolve(true),
      pollMs: 5,
      durationMs: 80,
    });
    let output = "";
    for await (const chunk of stream) output += String(chunk);
    expect(output).toContain('event: ready\ndata: {"next_cursor":"a"}');
    expect(output).toContain("id: b\nevent: feed");
    expect(output).toContain("id: c\nevent: checkpoint");
    expect(output).toContain("event: reconnect");
    expect(output.match(/event: feed/g)).toHaveLength(1);
    expect(getFeed).toHaveBeenCalledWith({
      after: "b",
      limit: 50,
      channel: "web",
    });
  });
  it("does not deliver a batch after access is revoked", async () => {
    const stream = createFeedStream({
      feed: { getFeed: vi.fn() },
      cursor: "a",
      first: { items: [{ secret: "report" }], nextCursor: "b" },
      scope: {},
      stillAuthorized: () => Promise.resolve(false),
    });
    let output = "";
    for await (const chunk of stream) output += String(chunk);
    expect(output).toContain("access_revoked");
    expect(output).not.toContain("report");
  });
  it.each([false, true])(
    "reports reset or redacted dependency failure (%s)",
    async (reset) => {
      const getFeed = vi
        .fn()
        .mockRejectedValue(
          reset
            ? new AppError("CURSOR_RESET_REQUIRED", "reset", 409)
            : new Error("postgres://private"),
        );
      const stream = createFeedStream({
        feed: { getFeed },
        cursor: "a",
        first: { items: [], nextCursor: "a" },
        scope: {},
        stillAuthorized: () => Promise.resolve(true),
        pollMs: 1,
      });
      let output = "";
      for await (const chunk of stream) output += String(chunk);
      expect(output).toContain(reset ? "reset_required" : "stream_error");
      expect(output).not.toContain("private");
    },
  );
  it("bounds stalled dependencies", async () => {
    await expect(
      bounded(new Promise<never>(() => {}), 5),
    ).rejects.toMatchObject({ code: "STREAM_UNAVAILABLE" });
  });
  it("releases only its own connection lease and fails closed", async () => {
    const evalCommand = vi.fn().mockResolvedValue(1);
    const release = await acquireStreamLease(
      { eval: evalCommand },
      "client",
      "test",
    );
    await release();
    expect(evalCommand.mock.calls[1]?.slice(1)).toEqual(
      evalCommand.mock.calls[0]?.slice(1),
    );
    evalCommand.mockResolvedValueOnce(0);
    await expect(
      acquireStreamLease({ eval: evalCommand }, "client", "test"),
    ).rejects.toMatchObject({ statusCode: 429 });
    evalCommand.mockRejectedValueOnce(new Error("private"));
    await expect(
      acquireStreamLease({ eval: evalCommand }, "client", "test"),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
