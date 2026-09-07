import type { Prisma, PrismaClient } from "./generated/prisma/client.ts";
import { createEventFingerprint, type EventDraft } from "@fcp/football-core";
import { v7 as uuidv7 } from "uuid";
import { assertInternalEventIds } from "./event-identities.js";
import { ensureContentWork } from "./outbox.js";

export async function createCanonicalEvent(
  prisma: PrismaClient,
  event: EventDraft & { fixtureId: string },
): Promise<{ id: string; created: boolean }> {
  assertInternalEventIds(event);
  const eventFingerprint = createEventFingerprint(event);
  const save = async (tx: Prisma.TransactionClient, conflict?: unknown) => {
    let existing = await tx.footballEvent.findUnique({
      where: { eventFingerprint },
      select: { id: true },
    });
    // Reconcile the pre-v2 positional IDs without rewriting immutable history.
    // Only exact legacy source fixture/team/player/type/time facts match.
    if (
      existing === null &&
      event.sourceEventId?.startsWith("api-football:v2:")
    ) {
      const parts = event.sourceEventId.split(":");
      const candidates = await tx.footballEvent.findMany({
        where: {
          fixtureId: event.fixtureId,
          eventType: event.eventType,
          minute: event.minute ?? null,
          extraTime: event.extraTime ?? null,
          sourceEventId: { startsWith: `${parts[2]}:` },
        },
        select: { id: true, sourceEventId: true },
      });
      existing =
        candidates.find((candidate) => {
          const old = candidate.sourceEventId?.split(":");
          return (
            old !== undefined &&
            /^\d+$/.test(old[2] ?? "") &&
            old[0] === parts[2] &&
            old[1] === (parts[3] === "none" ? "0" : parts[3]) &&
            old[3] === parts[5] &&
            old[4] === parts[6]
          );
        }) ?? null;
    }
    if (existing !== null) {
      // Duplicate processing must still repair a missing content handoff.
      await ensureContentWork(tx, existing.id);
      return { id: existing.id, created: false };
    }
    if (conflict !== undefined) {
      throw conflict instanceof Error
        ? conflict
        : new Error("Concurrent event creation failed", { cause: conflict });
    }
    const created = await tx.footballEvent.create({
      data: {
        id: uuidv7(),
        fixtureId: event.fixtureId,
        eventType: event.eventType,
        sourceEventId: event.sourceEventId ?? null,
        eventFingerprint,
        minute: event.minute ?? null,
        extraTime: event.extraTime ?? null,
        teamId: event.teamId ?? null,
        playerId: event.playerId ?? null,
        playerName: event.playerName ?? null,
        relatedEventId: event.relatedEventId ?? null,
        homeScore: event.homeScore ?? null,
        awayScore: event.awayScore ?? null,
        occurredAt: event.occurredAt ?? null,
        detectedAt: new Date(),
      },
      select: { id: true },
    });
    await ensureContentWork(tx, created.id);
    return { id: created.id, created: true };
  };
  try {
    return await prisma.$transaction((tx) => save(tx));
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "P2002"
    )
      throw error;
    // Requery in a NEW transaction, not the aborted conflicting transaction.
    return prisma.$transaction((tx) => save(tx, error));
  }
}
