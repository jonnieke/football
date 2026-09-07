/** Periodic liveness, independent of job arrivals. One write at a time. */
export function startHeartbeat(
  write: () => Promise<unknown>,
  onError: (error: unknown) => void,
  ttlSeconds: number,
): () => Promise<void> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1)
    throw new Error("Heartbeat TTL must be positive");
  let pending: Promise<void> | undefined;
  let stopped = false;
  const beat = () => {
    if (stopped || pending !== undefined) return;
    pending = Promise.resolve()
      .then(write)
      .then(() => undefined)
      .catch(onError)
      .finally(() => {
        pending = undefined;
      });
  };
  beat();
  const timer = setInterval(beat, Math.max(100, (ttlSeconds * 1000) / 3));
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
