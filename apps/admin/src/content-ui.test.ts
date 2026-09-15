import { runInNewContext, Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { contentScript, timingScript } from "./content-ui.js";

const now = Date.parse("2026-09-15T12:00:00Z");
const item = {
  kickoffAt: "2026-09-15T11:00:00Z",
  fixtureStatus: "live",
  standardText: "Reviewed full text",
  shortText: "Reviewed short alert",
};
function browser(confirm = vi.fn(() => true)) {
  return runInNewContext(
    timingScript + ";({draftTimingWarning,confirmDraftPublication})",
    { confirm },
  ) as {
    draftTimingWarning(item: object, now: number): string;
    confirmDraftPublication(item: object): boolean;
  };
}
describe("draft timing warnings", () => {
  it("flags finished matches even when kickoff was recent", () => {
    expect(
      browser().draftTimingWarning({ ...item, fixtureStatus: "finished" }, now),
    ).toContain("This match has finished");
  });
  it("flags the exact 24-hour boundary regardless of browser timezone", () => {
    expect(
      browser().draftTimingWarning(
        { ...item, kickoffAt: "2026-09-14T15:00:00+03:00" },
        now,
      ),
    ).toContain("HISTORICAL / CATCH-UP");
    expect(
      browser().draftTimingWarning(
        { ...item, kickoffAt: "2026-09-14T12:00:00.001Z" },
        now,
      ),
    ).toBe("");
  });
  it("does not label recent or future matches as verified live", () => {
    expect(browser().draftTimingWarning(item, now)).toBe("");
    expect(
      browser().draftTimingWarning(
        { ...item, kickoffAt: "2026-09-16T12:00:00Z" },
        now,
      ),
    ).toBe("");
  });
  it("warns about invalid timing", () => {
    expect(
      browser().draftTimingWarning({ ...item, kickoffAt: "invalid" }, now),
    ).toContain("TIMING UNVERIFIED");
  });
  it("cancelling the historical warning stops before publication confirmation", () => {
    const confirm = vi.fn(() => false);
    expect(
      browser(confirm).confirmDraftPublication({
        ...item,
        fixtureStatus: "finished",
      }),
    ).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]).toEqual([
      expect.stringContaining("does not add this label to the feed text"),
    ]);
  });
  it("requires both confirmations and retains the exact original text", () => {
    const confirm = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const original = { ...item, fixtureStatus: "finished" };
    expect(browser(confirm).confirmDraftPublication(original)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1]).toEqual([
      expect.stringContaining(
        item.standardText + "\n\nShort alert: " + item.shortText,
      ),
    ]);
    expect(original.standardText).toBe(item.standardText);
  });
  it("allows historical review only after both confirmations", () => {
    const confirm = vi.fn(() => true);
    expect(
      browser(confirm).confirmDraftPublication({
        ...item,
        fixtureStatus: "finished",
      }),
    ).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
  it("ships the warning and uses its result before the publish request", () => {
    expect(contentScript).toContain(
      "if (!confirmDraftPublication(item)) return;",
    );
    expect(contentScript).toContain(
      "timing.textContent = draftTimingWarning(item)",
    );
    expect(contentScript).toContain("(not the event time)");
    expect(() => new Script(contentScript)).not.toThrow();
  });
});
