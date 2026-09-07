import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors.js";

const sequence = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const cursorSchema = z
  .object({
    v: z.literal(2),
    epoch: z.uuid(),
    sequence,
    channel: z.string().min(1).max(80).nullable(),
    eventType: z.string().min(1).max(80).nullable(),
  })
  .strict();
export type FeedCursor = Omit<z.infer<typeof cursorSchema>, "v">;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createCursor(cursor: FeedCursor, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify(cursorSchema.parse({ v: 2, ...cursor })),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function parseCursor(value: string, secret: string): FeedCursor {
  try {
    if (value.length > 2048) throw new Error("size");
    const [payload, suppliedSignature, extra] = value.split(".");
    if (
      !payload ||
      !suppliedSignature ||
      extra !== undefined ||
      !/^[A-Za-z0-9_-]+$/.test(payload)
    )
      throw new Error("shape");
    const expected = Buffer.from(signature(payload, secret));
    const supplied = Buffer.from(suppliedSignature);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new Error("signature");
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (z.object({ v: z.literal(1) }).safeParse(parsed).success) {
      throw new AppError(
        "CURSOR_RESET_REQUIRED",
        "Timestamp cursors are retired. Restart without after and deduplicate by content ID.",
        409,
      );
    }
    const cursor = cursorSchema.parse(parsed);
    return {
      epoch: cursor.epoch,
      sequence: cursor.sequence,
      channel: cursor.channel,
      eventType: cursor.eventType,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INVALID_CURSOR",
      "The supplied cursor is invalid.",
      400,
      true,
      { cause: error },
    );
  }
}
