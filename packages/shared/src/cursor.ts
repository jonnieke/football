import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors.js";

const cursorSchema = z.object({
  v: z.literal(1),
  publishedAt: z.iso.datetime(),
  id: z.uuid(),
});

export interface FeedCursor {
  publishedAt: string;
  id: string;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createCursor(cursor: FeedCursor, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, ...cursor }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function parseCursor(value: string, secret: string): FeedCursor {
  try {
    const [payload, suppliedSignature, extra] = value.split(".");
    if (
      payload === undefined ||
      suppliedSignature === undefined ||
      extra !== undefined
    )
      throw new Error("shape");
    const expected = signature(payload, secret);
    const suppliedBuffer = Buffer.from(suppliedSignature);
    const expectedBuffer = Buffer.from(expected);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new Error("signature");
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const result = cursorSchema.parse(parsed);
    return { publishedAt: result.publishedAt, id: result.id };
  } catch (error) {
    throw new AppError(
      "INVALID_CURSOR",
      "The supplied cursor is invalid.",
      400,
      true,
      { cause: error },
    );
  }
}
