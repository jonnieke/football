import { expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "./generated/prisma/client.ts";
import { deliverNextMatchEmail, enqueueMatchEmails } from "./match-email.js";

it("queues only a short administrator alert and rejects oversized payloads", async () => {
  const findMany = vi.fn().mockResolvedValue([{ id: "recipient", email: "admin@example.com", version: 1 }]);
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = { alertRecipient: { findMany }, matchEmailDelivery: { createMany } } as unknown as Prisma.TransactionClient;
  const now = new Date("2026-09-16T10:00:00Z");
  await enqueueMatchEmails(tx, { eventId: "event", subject: "Live football alert", text: "GOAL 72' Home 2-1 Away", now });
  expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
    data: [expect.objectContaining({ text: "GOAL 72' Home 2-1 Away", email: "admin@example.com" }) as unknown],
  }));
  await expect(enqueueMatchEmails(tx, { eventId: "event", subject: "Alert", text: "x".repeat(151), now })).rejects.toThrow("150 characters");
  expect(createMany).toHaveBeenCalledTimes(1);
});

it("cancels old queued mail to non-admins before any provider call", async () => {
  const now = new Date("2026-09-16T10:00:00Z");
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    matchEmailDelivery: {
      findFirst: vi.fn().mockResolvedValue({
        id: "job", recipientId: "recipient", recipientVersion: 1,
        email: "outside@example.com", status: "pending", attempts: 0,
        text: "GOAL 72' Home 2-1 Away", subject: "Live football alert",
        expiresAt: new Date(now.getTime() + 60_000),
      }),
      updateMany,
    },
  } as unknown as PrismaClient;
  const send = vi.fn().mockResolvedValue("accepted");
  expect(await deliverNextMatchEmail(prisma, send, new Set(["admin@example.com"]), now)).toBe("cancelled");
  expect(send).not.toHaveBeenCalled();
  expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
    data: expect.objectContaining({ lastErrorCode: "NOT_ADMIN_RECIPIENT" }) as unknown,
  }));
});
