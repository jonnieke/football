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
    menuCmd: "All Day News/LiveScores",
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
          menuCmd: "All Day News/LiveScores",
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
      menuCmd: "All Day News/LiveScores",
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

  it("refuses delivery when event is not a score event (e.g. red_card)", async () => {
    const { prisma, stagingPushDelivery } = deliveryHarness();
    (stagingPushDelivery as Record<string, unknown>).count = vi.fn().mockResolvedValue(0);
    const contentItem = {
      findUnique: vi.fn().mockResolvedValue({
        event: {
          fixtureId: "f1111111-0000-0000-0000-000000000001",
          eventType: "red_card",
        },
      }),
    };
    const preMatchApproval = {
      findMany: vi.fn().mockResolvedValue([{ detailType: "scores" }]),
    };
    const extendedPrisma = {
      ...prisma,
      contentItem,
      preMatchApproval,
    };
    const send = vi.fn();
    await expect(deliverNextStagingPush(extendedPrisma as never, send, now)).resolves.toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(stagingPushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          lastErrorCode: "ONLY_SCORES_ALLOWED",
        }) as unknown,
      }),
    );
  });

  it("refuses delivery when per-game limit of 4 notifications is reached", async () => {
    const { prisma, stagingPushDelivery } = deliveryHarness();
    (stagingPushDelivery as Record<string, unknown>).findMany = vi.fn().mockResolvedValue([
      { content: { event: { eventType: "goal" } } },
      { content: { event: { eventType: "goal" } } },
      { content: { event: { eventType: "goal" } } },
      { content: { event: { eventType: "match_finished" } } },
    ]);
    const contentItem = {
      findUnique: vi.fn().mockResolvedValue({
        event: {
          fixtureId: "f1111111-0000-0000-0000-000000000001",
          eventType: "goal",
        },
      }),
    };
    const preMatchApproval = {
      findMany: vi.fn().mockResolvedValue([{ detailType: "scores" }]),
    };
    const extendedPrisma = {
      ...prisma,
      contentItem,
      preMatchApproval,
    };
    const send = vi.fn();
    await expect(deliverNextStagingPush(extendedPrisma as never, send, now)).resolves.toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(stagingPushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          lastErrorCode: "MAX_PER_GAME_LIMIT_REACHED",
        }) as unknown,
      }),
    );
  });

  it("caps in-game notifications at 3 so the 4th notification is preserved for final score", async () => {
    const { prisma, stagingPushDelivery } = deliveryHarness();
    (stagingPushDelivery as Record<string, unknown>).findMany = vi.fn().mockResolvedValue([
      { content: { event: { eventType: "goal" } } },
      { content: { event: { eventType: "goal" } } },
      { content: { event: { eventType: "penalty_goal" } } },
    ]);
    const contentItem = {
      findUnique: vi.fn().mockResolvedValue({
        event: {
          fixtureId: "f1111111-0000-0000-0000-000000000001",
          eventType: "goal",
        },
      }),
    };
    const preMatchApproval = {
      findMany: vi.fn().mockResolvedValue([{ detailType: "scores" }]),
    };
    const extendedPrisma = {
      ...prisma,
      contentItem,
      preMatchApproval,
    };
    const send = vi.fn();
    await expect(deliverNextStagingPush(extendedPrisma as never, send, now)).resolves.toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(stagingPushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          lastErrorCode: "MAX_IN_GAME_LIMIT_REACHED",
        }) as unknown,
      }),
    );
  });

  it("delivers full-time final score notification even after 3 in-game score alerts", async () => {
    const { prisma, stagingPushDelivery } = deliveryHarness({
      message: "FT: Arsenal 3-2 Chelsea.",
    });
    (stagingPushDelivery as Record<string, unknown>).findMany = vi.fn().mockResolvedValue([
      { content: { event: { eventType: "goal" } } },
      { content: { event: { eventType: "goal" } } },
      { content: { event: { eventType: "penalty_goal" } } },
    ]);
    const contentItem = {
      findUnique: vi.fn().mockResolvedValue({
        event: {
          fixtureId: "f1111111-0000-0000-0000-000000000001",
          eventType: "match_finished",
        },
      }),
    };
    const preMatchApproval = {
      findMany: vi.fn().mockResolvedValue([{ detailType: "scores" }]),
    };
    const extendedPrisma = {
      ...prisma,
      contentItem,
      preMatchApproval,
    };
    const send = vi.fn().mockResolvedValue("final-rec-99");
    await expect(deliverNextStagingPush(extendedPrisma as never, send, now)).resolves.toBe("delivered");
    expect(send).toHaveBeenCalledWith({
      id,
      text: "FT: Arsenal 3-2 Chelsea.",
      menuCmd: "All Day News/LiveScores",
      uploadedBy: "Football Content Platform",
    });
  });

  it("refuses duplicate final score notification if already delivered", async () => {
    const { prisma, stagingPushDelivery } = deliveryHarness({
      message: "FT: Arsenal 3-2 Chelsea.",
    });
    (stagingPushDelivery as Record<string, unknown>).findMany = vi.fn().mockResolvedValue([
      { content: { event: { eventType: "goal" } } },
      { content: { event: { eventType: "match_finished" } } },
    ]);
    const contentItem = {
      findUnique: vi.fn().mockResolvedValue({
        event: {
          fixtureId: "f1111111-0000-0000-0000-000000000001",
          eventType: "match_finished",
        },
      }),
    };
    const preMatchApproval = {
      findMany: vi.fn().mockResolvedValue([{ detailType: "scores" }]),
    };
    const extendedPrisma = {
      ...prisma,
      contentItem,
      preMatchApproval,
    };
    const send = vi.fn();
    await expect(deliverNextStagingPush(extendedPrisma as never, send, now)).resolves.toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(stagingPushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          lastErrorCode: "FINAL_SCORE_ALREADY_DELIVERED",
        }) as unknown,
      }),
    );
  });

  it("refuses delivery when pre-match approval has not been granted", async () => {
    const { prisma, stagingPushDelivery } = deliveryHarness();
    (stagingPushDelivery as Record<string, unknown>).count = vi.fn().mockResolvedValue(0);
    const contentItem = {
      findUnique: vi.fn().mockResolvedValue({
        event: {
          fixtureId: "f1111111-0000-0000-0000-000000000001",
          eventType: "goal",
        },
      }),
    };
    const preMatchApproval = {
      findMany: vi.fn().mockResolvedValue([]), // No approvals
    };
    const extendedPrisma = {
      ...prisma,
      contentItem,
      preMatchApproval,
    };
    const send = vi.fn();
    await expect(deliverNextStagingPush(extendedPrisma as never, send, now)).resolves.toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(stagingPushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          lastErrorCode: "PRE_MATCH_NOT_APPROVED",
        }) as unknown,
      }),
    );
  });

  it("delivers score alert when approved and under 4 notifications for the game", async () => {
    const { prisma, stagingPushDelivery } = deliveryHarness();
    (stagingPushDelivery as Record<string, unknown>).findMany = vi.fn().mockResolvedValue([
      { content: { event: { eventType: "goal" } } },
    ]);
    const contentItem = {
      findUnique: vi.fn().mockResolvedValue({
        event: {
          fixtureId: "f1111111-0000-0000-0000-000000000001",
          eventType: "goal",
        },
      }),
    };
    const preMatchApproval = {
      findMany: vi.fn().mockResolvedValue([{ detailType: "scores" }]),
    };
    const extendedPrisma = {
      ...prisma,
      contentItem,
      preMatchApproval,
    };
    const send = vi.fn().mockResolvedValue("5001");
    await expect(deliverNextStagingPush(extendedPrisma as never, send, now)).resolves.toBe("delivered");
    expect(send).toHaveBeenCalled();
  });
});
