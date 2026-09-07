import { describe, expect, it } from "vitest";
import { fixtureChangeJobId } from "./queues.js";

describe("fixture change job identity", () => {
  it("is stable and safe for BullMQ even with provider delimiters", () => {
    const id = fixtureChangeJobId("provider:fixture:1", "state:2");
    expect(id).toMatch(/^fixture-[a-f0-9]{64}$/);
    expect(id).toBe(fixtureChangeJobId("provider:fixture:1", "state:2"));
  });

  it("distinguishes observations and unambiguously encodes both fields", () => {
    expect(fixtureChangeJobId("fixture", "state1")).not.toBe(
      fixtureChangeJobId("fixture", "state2"),
    );
    expect(fixtureChangeJobId("a:b", "c")).not.toBe(
      fixtureChangeJobId("a", "b:c"),
    );
  });
});
