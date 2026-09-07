import type { NormalizedSourceEvent } from "./models.js";

export type SourceReviewReason =
  | "DUPLICATE_SOURCE_KEY"
  | "POSSIBLE_SOURCE_REVISION"
  | "LEGACY_BASELINE";
export interface SourceReviewCandidate {
  event: NormalizedSourceEvent;
  reason: SourceReviewReason;
  candidates: NormalizedSourceEvent[];
  occurrences: NormalizedSourceEvent[];
}

function family(event: NormalizedSourceEvent): string {
  return ["goal", "own_goal", "penalty_goal", "penalty_missed"].includes(
    event.eventType,
  )
    ? "goal_outcome"
    : event.eventType;
}

/** Conservative evidence classification, never an automatic identity merge. */
export function assessSourceReviews(
  history: readonly NormalizedSourceEvent[],
  current: readonly NormalizedSourceEvent[],
  legacyBaseline = false,
): SourceReviewCandidate[] {
  const known = new Map(history.map((event) => [event.sourceEventId, event]));
  const groups = new Map<string, NormalizedSourceEvent[]>();
  for (const event of current) {
    if (!event.sourceEventId)
      throw new Error("Source observation requires an event key");
    const group = groups.get(event.sourceEventId) ?? [];
    group.push(event);
    groups.set(event.sourceEventId, group);
  }
  const missing = [...known.values()].filter(
    (event) => !groups.has(event.sourceEventId!),
  );
  const reviews: SourceReviewCandidate[] = [];
  for (const [key, occurrences] of groups) {
    const event = occurrences[0]!;
    const candidates = missing.filter(
      (old) =>
        old.source === event.source &&
        old.sourceFixtureId === event.sourceFixtureId &&
        family(old) === family(event),
    );
    const reason: SourceReviewReason | undefined =
      occurrences.length > 1
        ? "DUPLICATE_SOURCE_KEY"
        : !known.has(key) && legacyBaseline
          ? "LEGACY_BASELINE"
          : !known.has(key) && candidates.length > 0
            ? "POSSIBLE_SOURCE_REVISION"
            : undefined;
    if (reason !== undefined)
      reviews.push({ event, reason, candidates, occurrences });
  }
  return reviews;
}
