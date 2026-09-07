import { describe, expect, it } from "vitest";
import { evaluateBacklog, type BacklogSnapshot } from "./monitoring.js";

const now = new Date("2026-09-08T00:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
function snapshot(overrides: Partial<BacklogSnapshot> = {}): BacklogSnapshot {
  return {
    observedAt: now,
    pending: { count: 0, oldest: null },
    paused: 0,
    reviews: { count: 0, oldest: null },
    providerExpected: false,
    lastProviderSuccess: null,
    ...overrides,
  };
}
describe("backlog alert evaluation", () => {
  it("does not alarm on an idle disabled provider or empty work queue", () => {
    expect(evaluateBacklog(snapshot()).status).toBe("ok");
  });
  it("alerts at the exact delivery age threshold", () => {
    expect(
      evaluateBacklog(snapshot({ pending: { count: 1, oldest: ago(299) } }))
        .status,
    ).toBe("ok");
    expect(
      evaluateBacklog(snapshot({ pending: { count: 1, oldest: ago(300) } }))
        .alerts,
    ).toEqual([{ code: "OUTBOX_DELAYED", severity: "critical" }]);
  });
  it("reports paused work even if it was intentionally paused", () => {
    expect(evaluateBacklog(snapshot({ paused: 2 })).status).toBe("warning");
  });
  it("only alerts on overdue pending source reviews", () => {
    expect(
      evaluateBacklog(snapshot({ reviews: { count: 1, oldest: ago(3599) } }))
        .status,
    ).toBe("ok");
    expect(
      evaluateBacklog(snapshot({ reviews: { count: 1, oldest: ago(3600) } }))
        .alerts[0]?.code,
    ).toBe("SOURCE_REVIEW_OVERDUE");
  });
  it.each([null, ago(180)])(
    "fails closed on missing/stale expected provider success",
    (lastProviderSuccess) => {
      expect(
        evaluateBacklog(
          snapshot({ providerExpected: true, lastProviderSuccess }),
        ).status,
      ).toBe("critical");
    },
  );
  it("accepts a recent successful empty poll", () => {
    expect(
      evaluateBacklog(
        snapshot({ providerExpected: true, lastProviderSuccess: ago(179) }),
      ).status,
    ).toBe("ok");
  });
  it("supports explicit validated thresholds", () => {
    expect(
      evaluateBacklog(snapshot({ pending: { count: 1, oldest: ago(10) } }), {
        outboxSeconds: 10,
      }).status,
    ).toBe("critical");
    expect(() => evaluateBacklog(snapshot(), { outboxSeconds: 0 })).toThrow();
    expect(() => evaluateBacklog(snapshot(), { unknown: 10 })).toThrow();
  });
  it("never emits an ok result for missing ages on nonempty work", () => {
    expect(
      evaluateBacklog(snapshot({ pending: { count: 1, oldest: null } })).status,
    ).toBe("critical");
  });
});
