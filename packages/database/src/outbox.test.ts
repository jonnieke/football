import { describe, expect, it, vi } from "vitest";
import {
  checkpointEvents,
  deliveryDelayMs,
  dispatchOutbox,
  ensureContentWork,
  ensureFixtureWork,
  preparedEventsSchema,
  retryWork,
} from "./outbox.js";

const id = "01994d90-0000-7000-8000-000000000001";
const previous = "01994d90-0000-7000-8000-000000000002";
const current = "01994d90-0000-7000-8000-000000000003";
function harness(
  kind = "fixture_change",
  payload: unknown = {
    fixtureId: id,
    previousStateId: previous,
    currentStateId: current,
  },
) {
  const record = {
    id,
    kind,
    payload,
    attempts: 0,
    completedAt: null,
    pausedAt: null,
    preparedData: null,
  };
  const methods = {
    findMany: vi.fn().mockResolvedValue([record]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue(record),
    findUniqueOrThrow: vi.fn().mockResolvedValue(record),
  };
  const store = { workOutbox: methods } as unknown as Parameters<
    typeof dispatchOutbox
  >[0];
  return { store, methods, record };
}

describe("durable outbox dispatch", () => {
  it("keeps enqueue-success work pending until a consumer completes it", async () => {
    const { store, methods } = harness();
    const deliver = vi.fn().mockResolvedValue(undefined);
    expect(await dispatchOutbox(store, deliver)).toEqual({
      delivered: 1,
      failed: 0,
      paused: 0,
    });
    expect(deliver).toHaveBeenCalledWith({
      id,
      kind: "fixture_change",
      payload: {
        fixtureId: id,
        previousStateId: previous,
        currentStateId: current,
      },
    });
    expect(methods.updateMany).toHaveBeenCalledTimes(1);
    expect(methods.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          attempts: { increment: 1 },
          availableAt: expect.any(Date) as unknown,
        },
      }),
    );
  });
  it("records failed queue delivery without completing or deleting work", async () => {
    const { store, methods } = harness();
    const result = await dispatchOutbox(
      store,
      vi.fn().mockRejectedValue(new Error("Redis lost")),
    );
    expect(result.failed).toBe(1);
    expect(methods.updateMany).toHaveBeenLastCalledWith({
      where: { id, completedAt: null },
      data: { lastErrorCode: "QUEUE_DELIVERY_FAILED" },
    });
  });
  it("can redeliver the same pending ID after a queue job disappears", async () => {
    const { store } = harness();
    const deliver = vi.fn().mockResolvedValue(undefined);
    await dispatchOutbox(store, deliver);
    await dispatchOutbox(store, deliver, new Date(Date.now() + 61_000));
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[0]).toEqual(deliver.mock.calls[1]);
  });
  it("does not deliver records claimed or completed by another dispatcher", async () => {
    const { store, methods } = harness();
    methods.updateMany.mockResolvedValueOnce({ count: 0 });
    const deliver = vi.fn();
    await dispatchOutbox(store, deliver);
    expect(deliver).not.toHaveBeenCalled();
  });
  it.each(["unknown_kind", "fixture_change"])(
    "pauses invalid %s payloads instead of losing them",
    async (kind) => {
      const { store, methods } = harness(kind, { fixtureId: "not-a-uuid" });
      const deliver = vi.fn();
      expect((await dispatchOutbox(store, deliver)).paused).toBe(1);
      expect(deliver).not.toHaveBeenCalled();
      expect(methods.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: {
            pausedAt: expect.any(Date) as unknown,
            lastErrorCode: "INVALID_OUTBOX_PAYLOAD",
          },
        }),
      );
    },
  );
  it("dispatches content work", async () => {
    const { store } = harness("content_generation", { eventId: id });
    const deliver = vi.fn().mockResolvedValue(undefined);
    await dispatchOutbox(store, deliver);
    expect(deliver).toHaveBeenCalledWith({
      id,
      kind: "content_generation",
      payload: { eventId: id },
    });
  });
  it("backs off with a bounded retry interval", () => {
    expect(deliveryDelayMs(0)).toBe(1000);
    expect(deliveryDelayMs(3)).toBe(8000);
    expect(deliveryDelayMs(1000)).toBe(60_000);
  });
});

describe("outbox identity, checkpoints, and operator retry", () => {
  it("does not reset completed work when ensuring an existing content handoff", async () => {
    const { store, methods } = harness();
    await ensureContentWork(store, id);
    expect(methods.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dedupeKey: `content-${id}` },
        update: {},
      }),
    );
  });
  it("uses stable fixture observation identities", async () => {
    const { store, methods } = harness();
    await ensureFixtureWork(store, {
      fixtureId: id,
      previousStateId: previous,
      currentStateId: current,
    });
    await ensureFixtureWork(store, {
      fixtureId: id,
      previousStateId: previous,
      currentStateId: current,
    });
    const [first, second] = methods.upsert.mock.calls as Array<
      [{ where: { dedupeKey: string } }]
    >;
    expect(first![0].where).toEqual(second![0].where);
  });
  it("reads the winning checkpoint after compare-and-set", async () => {
    const { store, methods } = harness();
    const winner = [{ fixtureId: id, eventType: "goal", minute: 12 }];
    methods.updateMany.mockResolvedValueOnce({ count: 0 });
    methods.findUniqueOrThrow.mockResolvedValueOnce({ preparedData: winner });
    const result = await checkpointEvents(store, id, [
      { fixtureId: id, eventType: "goal", minute: 13 },
    ]);
    expect(result).toEqual(winner);
  });
  it("restores dates and rejects invalid checkpoint identities", () => {
    expect(
      preparedEventsSchema.parse([
        {
          fixtureId: id,
          eventType: "goal",
          occurredAt: "2026-09-07T12:00:00Z",
        },
      ])[0]?.occurredAt,
    ).toBeInstanceOf(Date);
    expect(() =>
      preparedEventsSchema.parse([
        { fixtureId: id, eventType: "goal", playerId: "123" },
      ]),
    ).toThrow();
  });
  it("retry only targets incomplete work", async () => {
    const { store, methods } = harness();
    await retryWork(store, id);
    expect(methods.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, completedAt: null } }),
    );
    await expect(retryWork(store, "bad-id")).rejects.toThrow();
    expect(methods.updateMany).toHaveBeenCalledTimes(1);
  });
});
