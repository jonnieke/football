import { z } from "zod";
import type { PrismaClient } from "./generated/prisma/client.ts";
import { parseSourceEvents } from "./observations.js";
import { resolveSourceEventIdentities } from "./event-identities.js";
import { saveCanonicalEvent } from "./events.js";

export const reviewDecisionSchema = z.object({
  id: z.uuid(),
  action: z.enum(["publish-one", "dismiss"]),
  actor: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000),
});

/** Explicit operator decision; never called automatically by polling/workers. */
export async function decideSourceReview(
  prisma: PrismaClient,
  input: z.infer<typeof reviewDecisionSchema>,
) {
  const decision = reviewDecisionSchema.parse(input);
  const initial = await prisma.sourceEventReview.findUniqueOrThrow({
    where: { id: decision.id },
  });
  return prisma.$transaction(async (tx) => {
    // Same order as canonical writes. Concurrent/conflicting decisions serialize.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`source-review:${initial.fixtureId}`}, 0))`;
    const review = await tx.sourceEventReview.findUniqueOrThrow({
      where: { id: decision.id },
    });
    const status =
      decision.action === "publish-one" ? "published" : "dismissed";
    if (review.status !== "pending") {
      if (review.status !== status)
        throw new Error("Review already has a conflicting final decision");
      return {
        id: review.id,
        status: review.status,
        eventId: review.eventId,
        changed: false,
      };
    }
    await tx.sourceEventReview.update({
      where: { id: review.id },
      data: {
        status,
        decidedAt: new Date(),
        decidedBy: decision.actor,
        decisionReason: decision.reason,
      },
    });
    let eventId: string | null = null;
    if (decision.action === "publish-one") {
      const fixture = await tx.fixture.findUniqueOrThrow({
        where: { id: review.fixtureId },
        include: { homeTeam: true, awayTeam: true },
      });
      const source = parseSourceEvents([review.sourceEvent])[0]!;
      if (source.sourceEventId !== review.sourceEventId)
        throw new Error("Review key does not match its source evidence");
      const resolved = await resolveSourceEventIdentities(tx, fixture, source);
      if (resolved.issues.includes("UNKNOWN_SOURCE_TEAM"))
        throw new Error("Review team does not belong to its fixture");
      const event = await saveCanonicalEvent(tx, resolved.event);
      eventId = event.id;
      await tx.sourceEventReview.update({
        where: { id: review.id },
        data: { eventId },
      });
    }
    return { id: review.id, status, eventId, changed: true };
  });
}
