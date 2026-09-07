import { z } from "zod";
import type { PrismaClient } from "./generated/prisma/client.ts";

export const monitorThresholds = z
  .object({
    outboxSeconds: z.number().int().min(1).max(86400).default(300),
    reviewSeconds: z.number().int().min(1).max(604800).default(3600),
    providerSeconds: z.number().int().min(1).max(86400).default(180),
  })
  .strict();

export interface BacklogSnapshot {
  observedAt: Date;
  pending: { count: number; oldest: Date | null };
  paused: number;
  reviews: { count: number; oldest: Date | null };
  providerExpected: boolean;
  lastProviderSuccess: Date | null;
}

/** Bounded, read-only consistent snapshot. No payloads or credentials leave this collector. */
export function collectBacklog(prisma: PrismaClient): Promise<BacklogSnapshot> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      const [clock] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT CURRENT_TIMESTAMP AS now`;
      if (!clock) throw new Error("Missing database clock");
      const pending = await tx.workOutbox.aggregate({
        where: { completedAt: null, pausedAt: null },
        _count: true,
        _min: { createdAt: true },
      });
      const paused = await tx.workOutbox.count({
        where: { completedAt: null, pausedAt: { not: null } },
      });
      const reviews = await tx.sourceEventReview.aggregate({
        where: { status: "pending" },
        _count: true,
        _min: { createdAt: true },
      });
      const providerExpected = await tx.competition.count({
        where: { enabled: true, source: "api-football" },
      });
      const success = await tx.pollingRun.aggregate({
        where: {
          provider: "api-football",
          status: "succeeded",
          finishedAt: { not: null },
        },
        _max: { finishedAt: true },
      });
      return {
        observedAt: clock.now,
        pending: { count: pending._count, oldest: pending._min.createdAt },
        paused,
        reviews: { count: reviews._count, oldest: reviews._min.createdAt },
        providerExpected: providerExpected > 0,
        lastProviderSuccess: success._max.finishedAt,
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 },
  );
}

export function evaluateBacklog(
  snapshot: BacklogSnapshot,
  input: unknown = {},
) {
  const thresholds = monitorThresholds.parse(input);
  const age = (date: Date | null) =>
    date === null
      ? null
      : Math.max(0, (snapshot.observedAt.getTime() - date.getTime()) / 1000);
  const pendingAge = age(snapshot.pending.oldest);
  const reviewAge = age(snapshot.reviews.oldest);
  const providerAge = age(snapshot.lastProviderSuccess);
  const alerts: Array<{ code: string; severity: "warning" | "critical" }> = [];
  if (
    snapshot.pending.count > 0 &&
    (pendingAge === null || pendingAge >= thresholds.outboxSeconds)
  )
    alerts.push({ code: "OUTBOX_DELAYED", severity: "critical" });
  if (snapshot.paused > 0)
    alerts.push({ code: "OUTBOX_PAUSED", severity: "warning" });
  if (
    snapshot.reviews.count > 0 &&
    (reviewAge === null || reviewAge >= thresholds.reviewSeconds)
  )
    alerts.push({ code: "SOURCE_REVIEW_OVERDUE", severity: "warning" });
  if (
    snapshot.providerExpected &&
    (providerAge === null || providerAge >= thresholds.providerSeconds)
  )
    alerts.push({ code: "PROVIDER_POLL_STALE", severity: "critical" });
  return {
    version: 1,
    observedAt: snapshot.observedAt.toISOString(),
    status: alerts.some((alert) => alert.severity === "critical")
      ? "critical"
      : alerts.length > 0
        ? "warning"
        : "ok",
    thresholds,
    metrics: {
      pendingWork: snapshot.pending.count,
      oldestPendingSeconds: pendingAge,
      pausedWork: snapshot.paused,
      pendingReviews: snapshot.reviews.count,
      oldestReviewSeconds: reviewAge,
      providerExpected: snapshot.providerExpected,
      lastProviderSuccessSeconds: providerAge,
    },
    alerts,
  };
}
