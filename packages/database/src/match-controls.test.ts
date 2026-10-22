import { expect, it, vi } from "vitest";
import {
  changeMatchControl,
  matchAllowsPublication,
  MatchControlConflict,
} from "./match-controls.js";

it("blocks paused games and queued observations from before re-enabling", () => {
  const changedAt = new Date("2026-09-26T10:00:00Z");
  expect(
    matchAllowsPublication(
      { notificationsEnabled: false, notificationChangedAt: null },
      new Date(),
    ),
  ).toBe(false);
  expect(
    matchAllowsPublication(
      { notificationsEnabled: true, notificationChangedAt: changedAt },
      new Date("2026-09-26T09:59:59Z"),
    ),
  ).toBe(false);
  expect(
    matchAllowsPublication(
      { notificationsEnabled: true, notificationChangedAt: changedAt },
      new Date("2026-09-26T10:00:01Z"),
    ),
  ).toBe(true);
});

it("uses a publication lock and rejects stale administrator edits", async () => {
  const lock = vi.fn().mockResolvedValue(1);
  const update = vi.fn().mockResolvedValue({ count: 0 });
  const tx = { $executeRaw: lock, fixture: { updateMany: update } };
  const prisma = {
    $transaction: (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Parameters<typeof changeMatchControl>[0];
  await expect(
    changeMatchControl(
      prisma,
      {
        id: "01994d90-0000-7000-8000-000000000001",
        version: 1,
        enabled: false,
      },
      "admin@example.com",
    ),
  ).rejects.toBeInstanceOf(MatchControlConflict);
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
    update.mock.invocationCallOrder[0]!,
  );
});
