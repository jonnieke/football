import type { EventDraft } from "@fcp/football-core";

export const LIVE_MAX_AGE_MS = 120_000;
type Observation = {
  id: string;
  capturedAt: Date;
  status: string;
  minute: number | null;
};

/** Fail closed on bootstrap, outages, historical incidents, and invalid clocks. */
export function markLiveObservations(
  events: EventDraft[],
  previous: Observation,
  current: Observation,
  previousSourceIds: ReadonlySet<string>,
  previousObservedAt?: Date,
): EventDraft[] {
  // Use only the immutable poll timestamp attached to this work item, never
  // today's mutable fixture.lastPolledAt. Legacy jobs retain snapshot behavior.
  const baseline = previousObservedAt ?? previous.capturedAt;
  const gap = current.capturedAt.getTime() - baseline.getTime();
  const continuous =
    previous.id !== current.id &&
    baseline.getTime() >= previous.capturedAt.getTime() &&
    Number.isFinite(gap) &&
    gap > 0 &&
    gap <= LIVE_MAX_AGE_MS;
  return events.map((event) => {
    // Never inherit freshness from untrusted or legacy event payloads.
    const plain = { ...event };
    delete plain.liveObservedAt;
    const observationEvent =
      event.sourceEventId?.startsWith(`observation:${current.id}:`) === true;
    const minuteGap =
      current.minute === null || event.minute === undefined
        ? NaN
        : current.minute - event.minute;
    const sourceIsRecent =
      !["finished", "cancelled", "abandoned", "postponed"].includes(
        current.status,
      ) &&
      event.sourceEventId !== undefined &&
      !previousSourceIds.has(event.sourceEventId) &&
      Number.isFinite(minuteGap) &&
      minuteGap >= 0 &&
      minuteGap <= 2;
    return continuous && (observationEvent || sourceIsRecent)
      ? { ...plain, liveObservedAt: current.capturedAt }
      : plain;
  });
}

export function isFreshForPublication(
  observedAt: Date | undefined,
  now: Date,
): boolean {
  if (!observedAt) return false;
  const age = now.getTime() - observedAt.getTime();
  return Number.isFinite(age) && age >= 0 && age <= LIVE_MAX_AGE_MS;
}
