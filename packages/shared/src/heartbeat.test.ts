import { afterEach, expect, it, vi } from "vitest";
import { startHeartbeat } from "./heartbeat.js";

afterEach(() => vi.useRealTimers());
it("refreshes idle workers immediately and periodically, then stops", async () => {
  vi.useFakeTimers();
  const write = vi.fn().mockResolvedValue("OK");
  const stop = startHeartbeat(write, vi.fn(), 3);
  await vi.advanceTimersByTimeAsync(0);
  expect(write).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(write).toHaveBeenCalledTimes(3);
  await stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(write).toHaveBeenCalledTimes(3);
});
it("does not overlap writes and waits for an active write on shutdown", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const write = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const stop = startHeartbeat(write, vi.fn(), 3);
  await vi.advanceTimersByTimeAsync(5000);
  expect(write).toHaveBeenCalledTimes(1);
  const shutdown = stop();
  finish();
  await shutdown;
  await vi.advanceTimersByTimeAsync(5000);
  expect(write).toHaveBeenCalledTimes(1);
});
it("logs failed writes and retries on the next interval", async () => {
  vi.useFakeTimers();
  const error = new Error("unavailable");
  const write = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("OK");
  const log = vi.fn();
  const stop = startHeartbeat(write, log, 3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(log).toHaveBeenCalledWith(error);
  expect(write).toHaveBeenCalledTimes(2);
  await stop();
});
