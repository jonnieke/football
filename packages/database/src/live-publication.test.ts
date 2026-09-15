import { expect, it } from "vitest";
import {
  isFreshForPublication,
  markLiveObservations,
} from "./live-publication.js";
import type { EventDraft } from "@fcp/football-core";
const at = new Date("2026-09-15T12:00:00Z");
const previous = {
  id: "old",
  capturedAt: new Date(at.getTime() - 15000),
  status: "first_half",
  minute: 22,
};
const current = { id: "new", capturedAt: at, status: "first_half", minute: 23 };
const goal: EventDraft = {
  fixtureId: "f",
  eventType: "goal",
  minute: 23,
  sourceEventId: "api-football:v2:goal",
};
it("uses a recent successful quiet poll without moving the event's original clock", () => {
  const quiet = { ...previous, capturedAt: new Date(at.getTime() - 600000) };
  expect(
    markLiveObservations(
      [goal],
      quiet,
      current,
      new Set(),
      new Date(at.getTime() - 30000),
    )[0]?.liveObservedAt,
  ).toEqual(at);
  for (const baseline of [
    new Date(at.getTime() - 120001),
    new Date(at.getTime() + 1),
    at,
    new Date(NaN),
    new Date(quiet.capturedAt.getTime() - 1),
  ]) {
    expect(
      markLiveObservations([goal], quiet, current, new Set(), baseline)[0]
        ?.liveObservedAt,
    ).toBeUndefined();
  }
  expect(
    markLiveObservations(
      [goal],
      current,
      current,
      new Set(),
      new Date(at.getTime() - 30000),
    )[0]?.liveObservedAt,
  ).toBeUndefined();
});
it("marks a newly observed live goal without requiring approval", () => {
  expect(
    markLiveObservations([goal], previous, current, new Set())[0]
      ?.liveObservedAt,
  ).toEqual(at);
});
it("does not mark initial imports, outages, or invalid observation clocks", () => {
  for (const prior of [
    current,
    { ...previous, capturedAt: new Date(at.getTime() - 120001) },
    { ...previous, capturedAt: new Date(at.getTime() + 1) },
    { ...previous, capturedAt: new Date(NaN) },
  ])
    expect(
      markLiveObservations([goal], prior, current, new Set())[0]
        ?.liveObservedAt,
    ).toBeUndefined();
});
it("does not revive old goals, duplicates, unknown minutes or completed-match source incidents", () => {
  for (const event of [
    { ...goal, minute: 10 },
    { ...goal, minute: 24 },
    { ...goal, minute: undefined },
  ])
    expect(
      markLiveObservations(
        [event as EventDraft],
        previous,
        current,
        new Set(),
      )[0]?.liveObservedAt,
    ).toBeUndefined();
  expect(
    markLiveObservations(
      [goal],
      previous,
      current,
      new Set([goal.sourceEventId!]),
    )[0]?.liveObservedAt,
  ).toBeUndefined();
  expect(
    markLiveObservations(
      [goal],
      previous,
      { ...current, status: "finished" },
      new Set(),
    )[0]?.liveObservedAt,
  ).toBeUndefined();
});
it("automatically reports a continuously observed full-time transition", () => {
  const event: EventDraft = {
    fixtureId: "f",
    eventType: "match_finished",
    sourceEventId: "observation:new:status",
  };
  expect(
    markLiveObservations(
      [event],
      previous,
      { ...current, status: "finished" },
      new Set(),
    )[0]?.liveObservedAt,
  ).toEqual(at);
  expect(
    markLiveObservations([event], current, current, new Set())[0]
      ?.liveObservedAt,
  ).toBeUndefined();
});
it("preserves the original clock across queue delays and fails closed for legacy work", () => {
  expect(isFreshForPublication(at, new Date(at.getTime() + 120000))).toBe(true);
  expect(isFreshForPublication(at, new Date(at.getTime() + 120001))).toBe(
    false,
  );
  expect(isFreshForPublication(at, new Date(at.getTime() - 1))).toBe(false);
  expect(isFreshForPublication(undefined, at)).toBe(false);
  expect(isFreshForPublication(new Date(NaN), at)).toBe(false);
});
