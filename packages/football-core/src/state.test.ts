import { describe, expect, it } from "vitest";
import {
  compareFixtureStates,
  detectFixtureEvents,
  type FixtureState,
} from "./index.js";

const state = (
  home: number,
  away: number,
  status: FixtureState["status"] = "first_half",
): FixtureState => ({
  score: { home, away },
  status,
  minute: 20,
});

describe("compareFixtureStates", () => {
  it("recognizes a home goal", () => {
    expect(compareFixtureStates(state(0, 0), state(1, 0))).toMatchObject({
      scoreChanged: true,
      homeScoreDelta: 1,
      awayScoreDelta: 0,
      statusChanged: false,
    });
  });

  it("ignores repeated football state even if it was polled again", () => {
    expect(compareFixtureStates(state(1, 0), state(1, 0)).changed).toBe(false);
  });

  it("recognizes away goals and corrections", () => {
    expect(compareFixtureStates(state(1, 1), state(1, 2)).awayScoreDelta).toBe(
      1,
    );
    expect(compareFixtureStates(state(2, 1), state(1, 1)).homeScoreDelta).toBe(
      -1,
    );
  });
});

describe("detectFixtureEvents", () => {
  it.each([
    ["first_half", "half_time", "half_time"],
    ["half_time", "second_half", "second_half_started"],
    ["second_half", "finished", "match_finished"],
  ] as const)("maps %s to %s", (before, after, expected) => {
    expect(
      detectFixtureEvents("fixture", state(0, 0, before), state(0, 0, after)),
    ).toEqual([expect.objectContaining({ eventType: expected })]);
  });

  it("emits an append-only correction for a reduced score", () => {
    expect(
      detectFixtureEvents("fixture", state(2, 1), state(1, 1))[0]?.eventType,
    ).toBe("score_correction");
  });

  it("reports an aggregate update instead of inventing catch-up goals", () => {
    const events = detectFixtureEvents("fixture", state(0, 0), state(2, 0));
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("score_updated");
    expect(detectFixtureEvents("fixture", state(0, 0), state(2, 0))).toEqual(
      events,
    );
  });
});
