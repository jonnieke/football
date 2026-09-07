import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { AppError, createCursor, parseCursor } from "./index.js";

const secret = "this-is-a-test-secret-that-is-long-enough";
const input = {
  epoch: "0198f0cc-1b80-7000-8000-000000000001",
  sequence: "9007199254740993",
  channel: "epl",
  eventType: null,
};

describe("feed cursors", () => {
  const signed = (value: unknown) => {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
  };
  it("rejects a valid legacy cursor with an explicit recovery error", async () => {
    await expect(
      Promise.resolve().then(() =>
        parseCursor(
          signed({
            v: 1,
            publishedAt: "2026-08-28T18:54:14.000Z",
            id: input.epoch,
          }),
          secret,
        ),
      ),
    ).rejects.toMatchObject({
      code: "CURSOR_RESET_REQUIRED",
      statusCode: 409,
    });
  });
  it.each(["-1", "01", "1.5", "9223372036854775808", "1e3"])(
    "rejects invalid bigint position %s",
    (sequence) => {
      expect(() =>
        parseCursor(signed({ v: 2, ...input, sequence }), secret),
      ).toThrow(AppError);
    },
  );
  it("rejects malformed, oversized, unknown-version, and wrong-secret cursors", () => {
    for (const value of [
      "a.b.c",
      "x".repeat(2049),
      signed({ v: 3, ...input }),
      signed({ v: 2, ...input, surprise: true }),
    ])
      expect(() => parseCursor(value, secret)).toThrow(AppError);
    expect(() =>
      parseCursor(createCursor(input, secret), "wrong-secret"),
    ).toThrow(AppError);
  });
  it("round trips deterministically", () => {
    const cursor = createCursor(input, secret);
    expect(createCursor(input, secret)).toBe(cursor);
    expect(parseCursor(cursor, secret)).toEqual(input);
  });

  it("rejects tampering", () => {
    const cursor = createCursor(input, secret);
    expect(() => parseCursor(`${cursor}x`, secret)).toThrow(AppError);
  });
});
