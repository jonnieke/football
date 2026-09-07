import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import { fixtureChangeJobId } from "@fcp/shared";
import { FOOTBALL_EVENT_TYPES, type EventDraft } from "@fcp/football-core";
import { Prisma, type PrismaClient } from "./generated/prisma/client.ts";

type Store = Pick<PrismaClient, "workOutbox">;
export const fixtureWorkSchema = z.object({
  fixtureId: z.uuid(),
  previousStateId: z.uuid(),
  currentStateId: z.uuid(),
});
export const contentWorkSchema = z.object({ eventId: z.uuid() });
const draftSchema = z.object({
  fixtureId: z.uuid(),
  eventType: z.enum(FOOTBALL_EVENT_TYPES),
  sourceEventId: z.string().optional(),
  minute: z.number().int().optional(),
  extraTime: z.number().int().optional(),
  teamId: z.uuid().optional(),
  playerId: z.uuid().optional(),
  playerName: z.string().optional(),
  relatedEventId: z.uuid().optional(),
  homeScore: z.number().int().optional(),
  awayScore: z.number().int().optional(),
  occurredAt: z.coerce.date().optional(),
});
export const preparedEventsSchema = z
  .array(draftSchema)
  .transform((drafts) =>
    drafts.map(
      (draft) =>
        Object.fromEntries(
          Object.entries(draft).filter(([, value]) => value !== undefined),
        ) as EventDraft,
    ),
  );

export function ensureFixtureWork(
  store: Store,
  input: z.infer<typeof fixtureWorkSchema>,
) {
  const payload = fixtureWorkSchema.parse(input);
  const dedupeKey = fixtureChangeJobId(
    payload.fixtureId,
    payload.currentStateId,
  );
  return store.workOutbox.upsert({
    where: { dedupeKey },
    create: { id: uuidv7(), kind: "fixture_change", dedupeKey, payload },
    update: {},
  });
}

export function ensureContentWork(store: Store, eventId: string) {
  const payload = contentWorkSchema.parse({ eventId });
  const dedupeKey = `content-${payload.eventId}`;
  return store.workOutbox.upsert({
    where: { dedupeKey },
    create: { id: uuidv7(), kind: "content_generation", dedupeKey, payload },
    update: {},
  });
}

export async function checkpointEvents(
  store: Store,
  id: string,
  drafts: z.infer<typeof preparedEventsSchema>,
) {
  const validated = preparedEventsSchema.parse(drafts);
  const json = JSON.parse(JSON.stringify(validated)) as Prisma.InputJsonValue;
  await store.workOutbox.updateMany({
    where: { id, completedAt: null, preparedData: { equals: Prisma.DbNull } },
    data: { preparedData: json },
  });
  const record = await store.workOutbox.findUniqueOrThrow({ where: { id } });
  return preparedEventsSchema.parse(record.preparedData);
}

export async function completeWork(store: Store, id: string) {
  await store.workOutbox.updateMany({
    where: { id, completedAt: null },
    data: { completedAt: new Date(), lastErrorCode: null },
  });
}

export async function retryWork(store: Store, id: string) {
  z.uuid().parse(id);
  return store.workOutbox.updateMany({
    where: { id, completedAt: null },
    data: { availableAt: new Date(), pausedAt: null, lastErrorCode: null },
  });
}

export function deliveryDelayMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.min(Math.max(attempts, 0), 6));
}

type Delivery =
  | {
      kind: "fixture_change";
      id: string;
      payload: z.infer<typeof fixtureWorkSchema>;
    }
  | {
      kind: "content_generation";
      id: string;
      payload: z.infer<typeof contentWorkSchema>;
    };

/** Atomic claims are short DB operations. Queue calls happen after the claim commits. */
export async function dispatchOutbox(
  store: Store,
  deliver: (delivery: Delivery) => Promise<void>,
  now = new Date(),
  limit = 50,
) {
  const records = await store.workOutbox.findMany({
    where: { completedAt: null, pausedAt: null, availableAt: { lte: now } },
    orderBy: [{ availableAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  const result = { delivered: 0, failed: 0, paused: 0 };
  for (const record of records) {
    const claim = await store.workOutbox.updateMany({
      where: {
        id: record.id,
        completedAt: null,
        pausedAt: null,
        availableAt: { lte: now },
        attempts: record.attempts,
      },
      data: {
        attempts: { increment: 1 },
        availableAt: new Date(now.getTime() + deliveryDelayMs(record.attempts)),
      },
    });
    if (claim.count !== 1) continue;
    let delivery: Delivery;
    try {
      if (record.kind === "fixture_change")
        delivery = {
          kind: record.kind,
          id: record.id,
          payload: fixtureWorkSchema.parse(record.payload),
        };
      else if (record.kind === "content_generation")
        delivery = {
          kind: record.kind,
          id: record.id,
          payload: contentWorkSchema.parse(record.payload),
        };
      else throw new Error("Unknown outbox kind");
    } catch {
      await store.workOutbox.updateMany({
        where: { id: record.id, completedAt: null },
        data: { pausedAt: now, lastErrorCode: "INVALID_OUTBOX_PAYLOAD" },
      });
      result.paused += 1;
      continue;
    }
    try {
      await deliver(delivery);
      // Enqueue success is NOT completion. Pending records can be redelivered
      // after Redis loss or exhausted queue retries until a consumer commits.
      result.delivered += 1;
    } catch {
      await store.workOutbox.updateMany({
        where: { id: record.id, completedAt: null },
        data: { lastErrorCode: "QUEUE_DELIVERY_FAILED" },
      });
      result.failed += 1;
    }
  }
  return result;
}
