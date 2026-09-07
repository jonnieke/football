import { describe, expect, it } from "vitest";
import { assessSourceReviews } from "./source-review.js";
import type { NormalizedSourceEvent } from "./models.js";
const goal: NormalizedSourceEvent = {
  source: "api-football",
  sourceFixtureId: "42",
  sourceEventId: "original",
  eventType: "goal",
  minute: 10,
  sourceTeamId: "1",
  sourcePlayerId: "123",
};
describe("conservative source review policy", () => {
  it("ignores response reordering and display name edits", () => {
    const card = {
      ...goal,
      sourceEventId: "card",
      eventType: "red_card" as const,
    };
    expect(
      assessSourceReviews(
        [goal, card],
        [card, { ...goal, playerName: "New name" }],
      ),
    ).toEqual([]);
  });
  it.each(["minute", "player", "type", "team"])(
    "holds a possible %s revision instead of merging or publishing",
    (field) => {
      const replacement = {
        ...goal,
        sourceEventId: "replacement",
        ...(field === "minute"
          ? { minute: 11 }
          : field === "player"
            ? { sourcePlayerId: "456" }
            : field === "team"
              ? { sourceTeamId: "2" }
              : { eventType: "own_goal" as const }),
      };
      expect(assessSourceReviews([goal], [replacement])).toEqual([
        expect.objectContaining({
          reason: "POSSIBLE_SOURCE_REVISION",
          candidates: [goal],
        }),
      ]);
    },
  );
  it("uses retained history to catch a revision arriving after an empty poll", () => {
    expect(
      assessSourceReviews([goal], [{ ...goal, sourceEventId: "later" }])[0]
        ?.reason,
    ).toBe("POSSIBLE_SOURCE_REVISION");
  });
  it("holds indistinguishable occurrences even on the first observation", () => {
    const reviews = assessSourceReviews([], [goal, goal]);
    expect(reviews[0]?.reason).toBe("DUPLICATE_SOURCE_KEY");
    expect(reviews[0]?.occurrences).toHaveLength(2);
  });
  it("does not turn a missing goal into a cancellation or block an explicit VAR cancellation", () => {
    expect(assessSourceReviews([goal], [])).toEqual([]);
    expect(
      assessSourceReviews(
        [goal],
        [{ ...goal, sourceEventId: "var", eventType: "goal_cancelled" }],
      ),
    ).toEqual([]);
  });
  it("accepts an additional distinct event while existing events remain present", () => {
    expect(
      assessSourceReviews(
        [goal],
        [goal, { ...goal, sourceEventId: "second", minute: 30 }],
      ),
    ).toEqual([]);
  });
  it("holds new source events when the legacy baseline is unknown", () => {
    expect(assessSourceReviews([], [goal], true)[0]?.reason).toBe(
      "LEGACY_BASELINE",
    );
  });
});
