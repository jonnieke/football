import { randomUUID } from "node:crypto";
import { MAX_ADMIN_ALERT_LENGTH } from "@fcp/content-core";
import type { Prisma, PrismaClient } from "./generated/prisma/client.ts";

export const STAGING_PUSH_MENU_CMD =
  process.env.STAGING_PUSH_MENU_CMD ?? "All Day News/LiveScores";
export const STAGING_PUSH_UPLOADED_BY =
  process.env.STAGING_PUSH_UPLOADED_BY ?? "Football Content Platform";

/** Enqueued atomically with a newly published content item. */
export async function enqueueStagingPush(
  tx: Prisma.TransactionClient,
  input: { contentId: string; message: string; now: Date },
) {
  if (input.message.length === 0) throw new RangeError("Staging push is empty");
  if (input.message.length > MAX_ADMIN_ALERT_LENGTH)
    throw new RangeError("Staging push exceeds 150 characters");
  await tx.stagingPushDelivery.createMany({
    skipDuplicates: true,
    data: [
      {
        id: randomUUID(),
        contentId: input.contentId,
        message: input.message,
        menuCmd: STAGING_PUSH_MENU_CMD,
        uploadedBy: STAGING_PUSH_UPLOADED_BY,
        createdAt: input.now,
        availableAt: input.now,
        expiresAt: new Date(input.now.getTime() + 10 * 60_000),
      },
    ],
  });
}

export type StagingPushSend = (message: {
  id: string;
  text: string;
  menuCmd: string;
  uploadedBy: string;
}) => Promise<string>;

export class StagingPushSendError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly code = "STAGING_DATABASE_ERROR",
  ) {
    super(code);
  }
}

/** Claims and delivers one row. Remote duplicate rejection is accepted as success. */
export async function deliverNextStagingPush(
  prisma: PrismaClient,
  send: StagingPushSend,
  now = new Date(),
) {
  const eligible = {
    status: "pending",
    availableAt: { lte: now },
    OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
  };
  const job = await prisma.stagingPushDelivery.findFirst({
    where: eligible,
    orderBy: [{ availableAt: "asc" }, { id: "asc" }],
  });
  if (!job) return "idle";
  const token = randomUUID();
  const claimed = await prisma.stagingPushDelivery.updateMany({
    where: { id: job.id, ...eligible },
    data: {
      leaseToken: token,
      lockedUntil: new Date(now.getTime() + 60_000),
      attempts: { increment: 1 },
    },
  });
  if (!claimed.count) return "contended";
  const where = { id: job.id, leaseToken: token, status: "pending" };
  async function finish(
    status: string,
    lastErrorCode: string | null = null,
    targetRecordId: string | null = null,
  ) {
    await prisma.stagingPushDelivery.updateMany({
      where,
      data: {
        status,
        completedAt: now,
        lockedUntil: null,
        leaseToken: null,
        lastErrorCode,
        targetRecordId,
      },
    });
    return status;
  }
  if (job.expiresAt <= now) return finish("expired", "STALE_ALERT");
  if (!job.message || job.message.length > MAX_ADMIN_ALERT_LENGTH)
    return finish("failed", "INVALID_MESSAGE");
  if (job.attempts >= 10) return finish("failed", "RETRY_LIMIT");
  try {
    const targetRecordId = await send({
      id: job.id,
      text: job.message,
      menuCmd: job.menuCmd,
      uploadedBy: job.uploadedBy,
    });
    return finish("delivered", null, targetRecordId);
  } catch (error) {
    if (error instanceof StagingPushSendError && !error.retryable)
      return finish("failed", error.code);
    if (job.attempts + 1 >= 10) return finish("failed", "RETRY_LIMIT");
    await prisma.stagingPushDelivery.updateMany({
      where,
      data: {
        lockedUntil: null,
        leaseToken: null,
        availableAt: new Date(
          now.getTime() + Math.min(120, 2 ** job.attempts) * 1000,
        ),
        lastErrorCode:
          error instanceof StagingPushSendError
            ? error.code
            : "STAGING_DATABASE_UNAVAILABLE",
      },
    });
    return "retry";
  }
}
