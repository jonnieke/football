import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "./generated/prisma/client.ts";
import { MAX_ADMIN_ALERT_LENGTH } from "@fcp/content-core";

/** Called only inside the fresh automatic publication transaction, never history replay. */
export async function enqueueMatchEmails(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    text: string;
    subject: string;
    now: Date;
  },
) {
  if (input.text.length > MAX_ADMIN_ALERT_LENGTH)
    throw new RangeError("Administrator alert exceeds 150 characters");
  const recipients = await tx.alertRecipient.findMany({
    where: { enabled: true, matchAlerts: true },
    take: 100,
    orderBy: { id: "asc" },
  });
  if (!recipients.length) return;
  await tx.matchEmailDelivery.createMany({
    skipDuplicates: true,
    data: recipients.map((recipient) => ({
      id: randomUUID(),
      eventId: input.eventId,
      recipientId: recipient.id,
      recipientVersion: recipient.version,
      email: recipient.email,
      subject: input.subject.replace(/[\r\n]/g, " ").slice(0, 200),
      text: input.text,
      createdAt: input.now,
      availableAt: input.now,
      expiresAt: new Date(input.now.getTime() + 10 * 60_000),
    })),
  });
}

export type MatchEmailSend = (message: {
  id: string;
  email: string;
  subject: string;
  text: string;
}) => Promise<string>;
export class MatchEmailSendError extends Error {
  constructor(readonly retryable: boolean) {
    super("MATCH_EMAIL_PROVIDER_ERROR");
  }
}

/** One bounded send; independent of publication and queue workers. */
export async function deliverNextMatchEmail(
  prisma: PrismaClient,
  send: MatchEmailSend,
  adminEmails: ReadonlySet<string>,
  now = new Date(),
) {
  const eligible = {
    status: "pending",
    availableAt: { lte: now },
    OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
  };
  const job = await prisma.matchEmailDelivery.findFirst({
    where: eligible,
    orderBy: [{ availableAt: "asc" }, { id: "asc" }],
  });
  if (!job) return "idle";
  const token = randomUUID();
  const claimed = await prisma.matchEmailDelivery.updateMany({
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
    providerId: string | null = null,
  ) {
    await prisma.matchEmailDelivery.updateMany({
      where,
      data: {
        status,
        completedAt: now,
        lockedUntil: null,
        leaseToken: null,
        lastErrorCode,
        providerId,
      },
    });
    return status;
  }
  if (job.expiresAt <= now) return finish("expired", "STALE_ALERT");
  if (job.attempts >= 6) return finish("failed", "RETRY_LIMIT");
  if (job.text.length > MAX_ADMIN_ALERT_LENGTH)
    return finish("failed", "MESSAGE_TOO_LONG");
  if (!adminEmails.has(job.email.toLowerCase()))
    return finish("cancelled", "NOT_ADMIN_RECIPIENT");
  const recipient = await prisma.alertRecipient.findUnique({
    where: { id: job.recipientId },
  });
  if (
    !recipient?.enabled ||
    !recipient.matchAlerts ||
    recipient.version !== job.recipientVersion ||
    recipient.email !== job.email
  )
    return finish("cancelled", "RECIPIENT_CHANGED");
  let providerId: string;
  try {
    providerId = await send({
      id: job.id,
      email: job.email,
      subject: job.subject,
      text: job.text,
    });
  } catch (error) {
    if (error instanceof MatchEmailSendError && !error.retryable)
      return finish("failed", "PROVIDER_REJECTED");
    if (job.attempts + 1 >= 6) return finish("failed", "RETRY_LIMIT");
    await prisma.matchEmailDelivery.updateMany({
      where,
      data: {
        lockedUntil: null,
        leaseToken: null,
        availableAt: new Date(
          now.getTime() + Math.min(120, 5 * 2 ** job.attempts) * 1000,
        ),
        lastErrorCode: "PROVIDER_UNAVAILABLE",
      },
    });
    return "retry";
  }
  // If recording acceptance fails, the same immutable payload/idempotency key
  // will be retried after lease expiry, within the ten-minute lifetime.
  return finish("accepted", null, providerId);
}
