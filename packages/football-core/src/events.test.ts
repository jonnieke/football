import { describe, expect, it } from "vitest";
import { createEventFingerprint } from "./index.js";

describe("createEventFingerprint", () => {
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
