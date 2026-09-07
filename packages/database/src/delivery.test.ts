import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EventModule from "./events.js";
const mocks = vi.hoisted(() => ({ canonical: vi.fn(), generate: vi.fn() }));
vi.mock("./events.js", async (importOriginal) => ({
  ...(await importOriginal<typeof EventModule>()),
  createCanonicalEvent: mocks.canonical,
}));
vi.mock("@fcp/content-core", () => ({ generateContent: mocks.generate }));
import { processContentDelivery, processFixtureDelivery } from "./delivery.js";
import { SourceEventHeldError } from "./events.js";

const id = "01994d90-0000-7000-8000-000000000001";
const prev = "01994d90-0000-7000-8000-000000000002";
const curr = "01994d90-0000-7000-8000-000000000003";
const job = {
  outboxId: id,
  fixtureId: id,
  previousStateId: prev,
  currentStateId: curr,
};
const drafts = [
  { fixtureId: id, eventType: "goal" as const, homeScore: 1, awayScore: 0 },
];
function harness(kind = "fixture_change") {
  const record = {
    id,
    kind,
    payload: kind === "fixture_change" ? job : { eventId: id },
    preparedData: drafts,
    completedAt: null,
    pausedAt: null,
  };
  const workOutbox = {
    findUniqueOrThrow: vi.fn().mockResolvedValue(record),
    upsert: vi.fn().mockResolvedValue(record),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const contentItem = { upsert: vi.fn().mockResolvedValue({ id }) };
  const tx = { workOutbox, contentItem };
  const transaction = vi.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  const footballEvent = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({
      eventType: "goal",
      minute: 12,
      homeScore: 1,
      awayScore: 0,
      playerName: null,
      team: null,
      fixture: {
        homeTeam: { name: "Home", shortName: null },
        awayTeam: { name: "Away", shortName: null },
        competition: { slug: "test" },
      },
    }),
  };
  const prisma = {
    workOutbox,
    contentItem,
    footballEvent,
    $transaction: transaction,
  } as unknown as Parameters<typeof processFixtureDelivery>[0];
  return { prisma, workOutbox, contentItem, transaction, record };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.canonical.mockReset().mockResolvedValue({ id, created: true });
  mocks.generate.mockReset().mockReturnValue({
    channel: "test",
    contentType: "live_alert",
    priority: "breaking",
    shortText: "GOAL Home 1-0 Away",
    standardText: "GOAL Home 1-0 Away",
  });
});

describe("fixture delivery checkpoint recovery", () => {
  it("holds a checkpointed event when a later review gates it", async () => {
    const { prisma, workOutbox } = harness();
    mocks.canonical.mockRejectedValueOnce(new SourceEventHeldError(id));
    expect(await processFixtureDelivery(prisma, job, vi.fn())).toEqual({
      created: 0,
      duplicates: 0,
      held: 1,
    });
    expect(workOutbox.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          completedAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
    );
  });
  it("reuses persisted drafts without fetching upstream again", async () => {
    const { prisma, workOutbox } = harness();
    const prepare = vi.fn();
    expect(await processFixtureDelivery(prisma, job, prepare)).toEqual({
      created: 1,
      duplicates: 0,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(mocks.canonical).toHaveBeenCalledWith(prisma, drafts[0]);
    expect(workOutbox.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { completedAt: expect.any(Date) as unknown, lastErrorCode: null },
      }),
    );
  });
  it("saves drafts before creating any event", async () => {
    const { prisma, workOutbox, record } = harness();
    workOutbox.findUniqueOrThrow.mockResolvedValueOnce({
      ...record,
      preparedData: null,
    });
    const prepare = vi.fn().mockResolvedValue(drafts);
    await processFixtureDelivery(prisma, job, prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(workOutbox.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.canonical.mock.invocationCallOrder[0]!,
    );
  });
  it("leaves partial failures pending and retry does not prepare again", async () => {
    const { prisma, workOutbox } = harness();
    mocks.canonical.mockRejectedValueOnce(new Error("interrupted"));
    const prepare = vi.fn();
    await expect(processFixtureDelivery(prisma, job, prepare)).rejects.toThrow(
      "interrupted",
    );
    expect(workOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id, completedAt: null },
      data: { lastErrorCode: "WORKER_PROCESSING_FAILED" },
    });
    await processFixtureDelivery(prisma, job, prepare);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("does not reprocess completed work after lost queue acknowledgement", async () => {
    const { prisma, workOutbox, record } = harness();
    workOutbox.findUniqueOrThrow.mockResolvedValueOnce({
      ...record,
      completedAt: new Date(),
    });
    expect(await processFixtureDelivery(prisma, job, vi.fn())).toEqual({
      created: 0,
      duplicates: 0,
    });
    expect(mocks.canonical).not.toHaveBeenCalled();
  });
  it("continues across duplicate events so their content handoff can be repaired", async () => {
    const { prisma } = harness();
    mocks.canonical.mockResolvedValueOnce({ id, created: false });
    expect(await processFixtureDelivery(prisma, job, vi.fn())).toEqual({
      created: 0,
      duplicates: 1,
    });
  });
});

describe("content completion transaction", () => {
  it("writes content and completion in one transaction", async () => {
    const { prisma, transaction, contentItem, workOutbox } =
      harness("content_generation");
    await processContentDelivery(prisma, { outboxId: id, eventId: id }, 160);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(contentItem.upsert).toHaveBeenCalledTimes(1);
    expect(workOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, completedAt: null, pausedAt: null },
      }),
    );
  });
  it("does not publish if another consumer already completed the row", async () => {
    const { prisma, contentItem, workOutbox } = harness("content_generation");
    workOutbox.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(
      await processContentDelivery(prisma, { outboxId: id, eventId: id }, 160),
    ).toBeNull();
    expect(contentItem.upsert).not.toHaveBeenCalled();
  });
  it("rejects the transaction on content failure and records retryable failure", async () => {
    const { prisma, contentItem, workOutbox } = harness("content_generation");
    contentItem.upsert.mockRejectedValueOnce(new Error("write failed"));
    await expect(
      processContentDelivery(prisma, { outboxId: id, eventId: id }, 160),
    ).rejects.toThrow("write failed");
    expect(workOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id, completedAt: null },
      data: { lastErrorCode: "WORKER_PROCESSING_FAILED" },
    });
  });
  it("skips completed content work on redelivery", async () => {
    const { prisma, workOutbox, record } = harness("content_generation");
    workOutbox.findUniqueOrThrow.mockResolvedValueOnce({
      ...record,
      completedAt: new Date(),
    });
    expect(
      await processContentDelivery(prisma, { outboxId: id, eventId: id }, 160),
    ).toBeNull();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
