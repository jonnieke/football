import { runInNewContext, Script } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { liveScript } from "./live-ui.js";
import { browserScript } from "./ui.js";
afterEach(() => vi.useRealTimers());
class Element {
  children: Element[] = [];
  parent?: Element;
  dataset: Record<string, string> = {};
  textContent = "";
  id = "";
  className = "";
  listeners = new Map<string, () => void>();
  addEventListener(name: string, fn: () => void) {
    this.listeners.set(name, fn);
  }
  append(...items: Element[]) {
    for (const item of items) {
      item.parent = this;
      this.children.push(item);
    }
  }
  prepend(item: Element) {
    item.parent = this;
    this.children.unshift(item);
  }
  replaceChildren() {
    this.children = [];
  }
  get lastElementChild() {
    return this.children.at(-1);
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (item) => item !== this,
      );
  }
}
const item = {
  id: "1",
  match: "Home v Away",
  league: "Test",
  season: 2026,
  eventType: "goal",
  minute: 23,
  shortText: "<img src=x> GOAL",
  publishedAt: "2026-09-15T12:00:00Z",
  kickoffAt: "2026-09-15T11:00:00Z",
};
function setup() {
  vi.useFakeTimers();
  const ids = new Map(
    ["live-items", "live-alert", "live-status", "live-toggle"].map((id) => [
      id,
      new Element(),
    ]),
  );
  const document = {
    hidden: false,
    createElement: () => new Element(),
    addEventListener: vi.fn(),
  };
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        items: [item],
        cursor: "cursor1",
        checkedAt: item.publishedAt,
        reset: false,
        more: false,
      }),
  });
  const location = { assign: vi.fn() };
  const start = runInNewContext(liveScript + ";startLiveFeed", {
    document,
    window: { addEventListener() {} },
    byId: (id: string) => ids.get(id),
    fetch,
    location,
    setTimeout,
    clearTimeout,
    AbortController,
  }) as () => Promise<void>;
  return { start, ids, fetch, location, document };
}
it("renders initial history quietly, polls automatically and deduplicates repeated items", async () => {
  const { start, ids, fetch } = setup();
  await start();
  expect(ids.get("live-alert")?.textContent).toContain("not new-event alerts");
  expect(ids.get("live-items")?.children[0]?.children[2]?.textContent).toBe(
    item.shortText,
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/live-feed?after=cursor1");
  expect(ids.get("live-items")?.children).toHaveLength(1);
  expect(ids.get("live-alert")?.textContent).toBe("");
});
it("pauses only the display and resumes from the retained position", async () => {
  const { start, ids, fetch } = setup();
  await start();
  ids.get("live-toggle")!.listeners.get("click")!();
  await vi.advanceTimersByTimeAsync(20000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(ids.get("live-status")?.textContent).toContain(
    "Background reporting is unchanged",
  );
  ids.get("live-toggle")!.listeners.get("click")!();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("shows stale state on failure and retries without losing its cursor", async () => {
  const { start, ids, fetch } = setup();
  await start();
  fetch.mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(5000);
  expect(ids.get("live-status")?.textContent).toContain("may be stale");
  expect(ids.get("live-items")?.children).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("stops on session expiry and does not poll hidden pages", async () => {
  const { start, document, fetch, location } = setup();
  document.hidden = true;
  await start();
  expect(fetch).not.toHaveBeenCalled();
  document.hidden = false;
  fetch.mockResolvedValueOnce({ ok: false, status: 401 });
  await start();
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(location.assign).toHaveBeenCalledWith("/login");
});
it("ships valid JavaScript and uses text-only rendering", () => {
  expect(() => new Script(browserScript)).not.toThrow();
  expect(liveScript).not.toContain("innerHTML");
});
