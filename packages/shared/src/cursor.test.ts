import { describe, expect, it } from "vitest";
import { AppError, createCursor, parseCursor } from "./index.js";

const secret = "this-is-a-test-secret-that-is-long-enough";
const input = {
  publishedAt: "2026-08-28T18:54:14.000Z",
  id: "0198f0cc-1b80-7000-8000-000000000001",
};

describe("feed cursors", () => {
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
