import { describe, expect, it } from "vitest";
import {
  createEventFingerprint,
  detectFixtureEvents,
  type FixtureState,
} from "./index.js";

describe("createEventFingerprint", () => {
  it("keeps v2 source identity stable as display facts and aggregate scores change", () => {
    const event = {
      fixtureId: "f1",
      eventType: "goal" as const,
      sourceEventId: "api-football:v2:42:12:none:1:2:goal",
    };
    expect(createEventFingerprint(event)).toBe(
      createEventFingerprint({
        ...event,
        homeScore: 3,
        playerName: "Updated name",
      }),
    );
    expect(createEventFingerprint(event)).not.toBe(
      createEventFingerprint({
        ...event,
        sourceEventId: `${event.sourceEventId}:other`,
      }),
    );
  });
  it("keeps repeated score corrections distinct by observation", () => {
    const before: FixtureState = {
      status: "first_half",
      score: { home: 1, away: 0 },
    };
    const after: FixtureState = { ...before, score: { home: 0, away: 0 } };
    const a = detectFixtureEvents("f1", before, after, [], "a")[0]!;
    const b = detectFixtureEvents("f1", before, after, [], "b")[0]!;
    expect(createEventFingerprint(a)).not.toBe(createEventFingerprint(b));
    expect(a.relatedEventId).toBeUndefined();
  });
  it.each(["red_card", "penalty_missed", "goal_cancelled", "goal"] as const)(
    "detects late %s without a score or clock change",
    (eventType) => {
      const state: FixtureState = {
        status: "second_half",
        minute: 80,
        score: { home: 2, away: 0 },
      };
      const event = {
        fixtureId: "f1",
        eventType,
        minute: 12,
        sourceEventId: "source",
      };
      expect(detectFixtureEvents("f1", state, state, [event])).toEqual([event]);
    },
  );
  it("emits only the observed lifecycle on first sight, not fabricated earlier transitions", () => {
    expect(
      detectFixtureEvents(
        "f1",
        null,
        { status: "first_half", score: { home: 0, away: 0 } },
        [],
        "s1",
      ),
    ).toEqual([expect.objectContaining({ eventType: "match_started" })]);
    expect(
      detectFixtureEvents(
        "f1",
        null,
        { status: "finished", score: { home: 2, away: 0 } },
        [],
        "s2",
      ),
    ).toEqual([expect.objectContaining({ eventType: "match_finished" })]);
  });
  it("is stable and changes with semantic input", () => {
    const event = {
      fixtureId: "f1",
      eventType: "goal" as const,
      minute: 67,
      teamId: "t1",
    };
    expect(createEventFingerprint(event)).toBe(
      createEventFingerprint({ ...event }),
    );
    expect(createEventFingerprint(event)).not.toBe(
      createEventFingerprint({ ...event, minute: 68 }),
    );
  });
});
