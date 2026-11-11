import { randomUUID } from "node:crypto";
import { MAX_ADMIN_ALERT_LENGTH } from "@fcp/content-core";
import type { Prisma, PrismaClient } from "./generated/prisma/client.ts";
import {
  getEATDateString,
  isEventTypeCoveredByDetails,
  isFinalScoreEvent,
  isInGameScoreEvent,
  isScoreEvent,
  MAX_FINAL_SCORE_NOTIFICATIONS,
  MAX_IN_GAME_NOTIFICATIONS,
  MAX_PER_GAME_NOTIFICATIONS,
} from "./pre-match.js";

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

  const todayStr = getEATDateString(now);

  type QueryFn<T = unknown> = (...args: unknown[]) => Promise<T>;
  const extendedPrisma = prisma as unknown as {
    contentItem?: { findUnique?: QueryFn<{ event?: { fixtureId: string; eventType: string } } | null> };
    preMatchApproval?: { findMany?: QueryFn<Array<{ detailType: string }>> };
    stagingPushDelivery?: {
      count?: QueryFn<number>;
      findMany?: QueryFn<Array<{ content?: { event?: { eventType?: string } } }>>;
    };
  };
  if (
    typeof extendedPrisma.contentItem?.findUnique === "function" &&
    typeof extendedPrisma.preMatchApproval?.findMany === "function"
  ) {
    const contentItem = await extendedPrisma.contentItem.findUnique({
      where: { id: job.contentId },
      select: {
        event: {
          select: {
            fixtureId: true,
            eventType: true,
          },
        },
      },
    });

    if (contentItem?.event) {
      // 1. Restriction: only scores per game (no red cards, yellow cards, duration, etc.)
      if (!isScoreEvent(contentItem.event.eventType)) {
        return finish("failed", "ONLY_SCORES_ALLOWED");
      }

      // 2. Pre-match approval: must be approved for this match on this date
      const approvals = (await extendedPrisma.preMatchApproval.findMany({
        where: {
          date: todayStr,
          fixtureId: contentItem.event.fixtureId,
        },
        select: { detailType: true },
      })) ?? [];
      const detailTypes = new Set(approvals.map((a) => a.detailType));
      if (!isEventTypeCoveredByDetails(contentItem.event.eventType, detailTypes)) {
        return finish("failed", "PRE_MATCH_NOT_APPROVED");
      }

      // 3. Restriction: maximum 4 notifications per game (max 3 live in-game + 1 final score)
      if (typeof extendedPrisma.stagingPushDelivery?.findMany === "function") {
        const deliveredRows = (await extendedPrisma.stagingPushDelivery.findMany({
          where: {
            status: "delivered",
            content: {
              event: {
                fixtureId: contentItem.event.fixtureId,
              },
            },
          },
          select: {
            content: {
              select: {
                event: {
                  select: {
                    eventType: true,
                  },
                },
              },
            },
          },
        })) ?? [];

        const totalDelivered = deliveredRows.length;
        if (totalDelivered >= MAX_PER_GAME_NOTIFICATIONS) {
          return finish("failed", "MAX_PER_GAME_LIMIT_REACHED");
        }

        const currentEventType = contentItem.event.eventType;

        const inGameDelivered = deliveredRows.filter((row) =>
          isInGameScoreEvent(row.content?.event?.eventType ?? ""),
        ).length;

        const finalScoreDelivered = deliveredRows.filter((row) =>
          isFinalScoreEvent(row.content?.event?.eventType ?? ""),
        ).length;

        if (isInGameScoreEvent(currentEventType)) {
          // Cap in-game notifications to 3 so the 4th slot is reserved for final score
          if (inGameDelivered >= MAX_IN_GAME_NOTIFICATIONS) {
            return finish("failed", "MAX_IN_GAME_LIMIT_REACHED");
          }
        } else if (isFinalScoreEvent(currentEventType)) {
          // Maximum 1 final score notification after full-time
          if (finalScoreDelivered >= MAX_FINAL_SCORE_NOTIFICATIONS) {
            return finish("failed", "FINAL_SCORE_ALREADY_DELIVERED");
          }
        }
      } else if (typeof extendedPrisma.stagingPushDelivery?.count === "function") {
        const deliveredForFixture = await extendedPrisma.stagingPushDelivery.count({
          where: {
            status: "delivered",
            content: {
              event: {
                fixtureId: contentItem.event.fixtureId,
              },
            },
          },
        });
        if (deliveredForFixture >= MAX_PER_GAME_NOTIFICATIONS) {
          return finish("failed", "MAX_PER_GAME_LIMIT_REACHED");
        }
      }
    }
  }

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
