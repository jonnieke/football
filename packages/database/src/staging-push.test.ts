import { describe, expect, it, vi } from "vitest";
import {
  deliverNextStagingPush,
  enqueueStagingPush,
  StagingPushSendError,
} from "./staging-push.js";

const id = "01994d90-0000-7000-8000-000000000001";
const now = new Date("2026-09-25T10:00:00.000Z");

function deliveryHarness(overrides: Record<string, unknown> = {}) {
  const job = {
    id,
    contentId: id,
    message: "GOAL 67': Arsenal 2-1 Chelsea.",
    menuCmd: "LIVESCORES",
    uploadedBy: "Football Content Platform",
    status: "pending",
    attempts: 0,
    availableAt: now,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    lockedUntil: null,
    leaseToken: null,
    ...overrides,
  };
  const stagingPushDelivery = {
    findFirst: vi.fn().mockResolvedValue(job),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  return {
    prisma: { stagingPushDelivery } as unknown as Parameters<
      typeof deliverNextStagingPush
    >[0],
    stagingPushDelivery,
  };
}

describe("staging push delivery ledger", () => {
  it("queues one immutable 150-character-or-shorter message per content item", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    await enqueueStagingPush({ stagingPushDelivery: { createMany } } as never, {
      contentId: id,
      message: "Kick-off: Arsenal v Chelsea",
      now,
    });
    expect(createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          contentId: id,
          message: "Kick-off: Arsenal v Chelsea",
          menuCmd: "LIVESCORES",
          uploadedBy: "Football Content Platform",
          expiresAt: new Date("2026-09-25T10:10:00.000Z"),
        }),
      ],
    });
    await expect(
      enqueueStagingPush({ stagingPushDelivery: { createMany } } as never, {
        contentId: id,
        message: "x".repeat(151),
        now,
      }),
    ).rejects.toThrow(/150/);
  });

  it("marks a successful insert delivered", async () => {
    const { prisma, stagingPushDelivery } = deliveryHarness();
    const send = vi.fn().mockResolvedValue("412");
    await expect(deliverNextStagingPush(prisma, send, now)).resolves.toBe(
      "delivered",
    );
    expect(send).toHaveBeenCalledWith({
      id,
      text: "GOAL 67': Arsenal 2-1 Chelsea.",
      menuCmd: "LIVESCORES",
      uploadedBy: "Football Content Platform",
    });
    expect(stagingPushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "delivered",
          targetRecordId: "412",
        }) as unknown,
      }),
    );
  });

  it("releases the lease and retries a temporary database failure", async () => {
    const { prisma, stagingPushDelivery } = deliveryHarness();
    const send = vi
      .fn()
      .mockRejectedValue(new StagingPushSendError(true, "ETIMEDOUT"));
    await expect(deliverNextStagingPush(prisma, send, now)).resolves.toBe(
      "retry",
    );
    expect(stagingPushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaseToken: null,
          lockedUntil: null,
          lastErrorCode: "ETIMEDOUT",
        }) as unknown,
      }),
    );
  });

  it("expires a delayed live alert instead of sending stale news", async () => {
    const { prisma } = deliveryHarness({
      expiresAt: new Date(now.getTime() - 1),
    });
    const send = vi.fn();
    await expect(deliverNextStagingPush(prisma, send, now)).resolves.toBe(
      "expired",
    );
    expect(send).not.toHaveBeenCalled();
  });
});
