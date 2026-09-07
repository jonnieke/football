import { describe, expect, it, vi } from "vitest";
import { createCanonicalEvent } from "./events.js";

const id = "01994d90-0000-7000-8000-000000000001";
const draft = {
  fixtureId: id,
  eventType: "goal" as const,
  homeScore: 1,
  awayScore: 0,
};
function harness() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    sourceEventReview: { findUnique: vi.fn().mockResolvedValue(null) },
    footballEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id }),
    },
    workOutbox: { upsert: vi.fn().mockResolvedValue({ id }) },
  };
  const transaction = vi.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  const prisma = { $transaction: transaction } as unknown as Parameters<
    typeof createCanonicalEvent
  >[0];
  return { tx, transaction, prisma };
}
describe("atomic event and content handoff", () => {
  it.each(["pending", "dismissed"])(
    "does not bypass a %s review on direct or checkpointed persistence",
    async (status) => {
      const { prisma, tx } = harness();
      tx.sourceEventReview.findUnique.mockResolvedValue({ id, status });
      await expect(
        createCanonicalEvent(prisma, { ...draft, sourceEventId: "source-key" }),
      ).rejects.toThrow("held by an operator review");
      expect(tx.footballEvent.create).not.toHaveBeenCalled();
      expect(tx.workOutbox.upsert).not.toHaveBeenCalled();
    },
  );
  it("recognizes legacy positional IDs without rewriting their history", async () => {
    const { tx, prisma } = harness();
    tx.footballEvent.findMany.mockResolvedValue([
      { id, sourceEventId: "42:12:7:1:123:Normal Goal" },
    ]);
    expect(
      await createCanonicalEvent(prisma, {
        ...draft,
        minute: 12,
        sourceEventId: "api-football:v2:42:12:none:1:123:goal",
      }),
    ).toEqual({ id, created: false });
    expect(tx.footballEvent.create).not.toHaveBeenCalled();
  });
  it("does not merge legacy events for a different source player", async () => {
    const { tx, prisma } = harness();
    tx.footballEvent.findMany.mockResolvedValue([
      { id, sourceEventId: "42:12:7:1:999:Normal Goal" },
    ]);
    expect(
      (
        await createCanonicalEvent(prisma, {
          ...draft,
          minute: 12,
          sourceEventId: "api-football:v2:42:12:none:1:123:goal",
        })
      ).created,
    ).toBe(true);
  });
  it("writes the event and outbox through the same transaction client", async () => {
    const { tx, transaction, prisma } = harness();
    expect(await createCanonicalEvent(prisma, draft)).toEqual({
      id,
      created: true,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.footballEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.workOutbox.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dedupeKey: `content-${id}` } }),
    );
  });
  it("ensures content work even for an existing event", async () => {
    const { tx, prisma } = harness();
    tx.footballEvent.findUnique.mockResolvedValueOnce({ id });
    expect(await createCanonicalEvent(prisma, draft)).toEqual({
      id,
      created: false,
    });
    expect(tx.footballEvent.create).not.toHaveBeenCalled();
    expect(tx.workOutbox.upsert).toHaveBeenCalledTimes(1);
  });
  it("rejects the transaction when handoff persistence fails", async () => {
    const { tx, prisma } = harness();
    tx.workOutbox.upsert.mockRejectedValueOnce(new Error("outbox unavailable"));
    await expect(createCanonicalEvent(prisma, draft)).rejects.toThrow(
      "outbox unavailable",
    );
  });
  it("recovers a unique race using a new transaction and still ensures delivery", async () => {
    const { tx, transaction, prisma } = harness();
    tx.footballEvent.create.mockRejectedValueOnce({ code: "P2002" });
    tx.footballEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id });
    expect(await createCanonicalEvent(prisma, draft)).toEqual({
      id,
      created: false,
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(tx.workOutbox.upsert).toHaveBeenCalledTimes(1);
  });
});
