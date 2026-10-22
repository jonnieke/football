import { Script, runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { leagueHtml, leagueScript, popularLeagues } from "./league-ui.js";
import { browserScript } from "./ui.js";

it("ships valid browser code with paused onboarding and no unsafe HTML insertion", () => {
  expect(() => new Script(browserScript)).not.toThrow();
  expect(leagueHtml).toContain("Enable selected leagues");
  expect(leagueHtml).toContain("Advanced: add another league by ID");
  expect(leagueHtml).toContain("Add paused league");
  expect(leagueHtml).toContain("It does not verify provider coverage");
  expect(popularLeagues.map((league) => league.name)).toContain("Premier League");
  expect(new Set(popularLeagues.map((league) => league.sourceId)).size).toBe(
    popularLeagues.length,
  );
  expect(leagueScript).not.toMatch(/innerHTML|insertAdjacentHTML/);
});
it("sends the exact league version after confirmation and sends nothing on cancel", async () => {
  const elements: {
    children: unknown[];
    textContent: string;
    addEventListener: ReturnType<typeof vi.fn>;
    append: (...items: unknown[]) => void;
    replaceWith: ReturnType<typeof vi.fn>;
  }[] = [];
  const createElement = () => {
    const element = {
      children: [] as unknown[],
      textContent: "",
      addEventListener: vi.fn(),
      append(...items: unknown[]) {
        this.children.push(...items);
      },
      replaceWith: vi.fn(),
    };
    elements.push(element);
    return element;
  };
  const api = vi.fn().mockResolvedValue({
    item: { id: "league-id", enabled: true, coverageVersion: 2 },
    items: [],
  });
  const confirm = vi.fn(() => false);
  let pending: Promise<unknown> | undefined;
  const card = runInNewContext(leagueScript + ";leagueCard", {
    document: { createElement },
    currentRole: "admin",
    byId: () => ({ value: "2026", addEventListener() {}, replaceChildren() {}, append() {} }),
    confirm,
    loadDashboard: vi.fn().mockResolvedValue(undefined),
    api,
    notice: vi.fn(),
    busy: (_button: unknown, work: () => Promise<unknown>) => {
      pending = work();
    },
  }) as (item: object) => unknown;
  card({
    id: "league-id",
    name: "<img src=x>",
    season: 2026,
    sourceId: "39",
    enabled: false,
    coverageVersion: 1,
  });
  const button = elements.find(
    (item) => item.textContent === "Enable automatic reporting",
  )!;
  const click = button.addEventListener.mock.calls[0]![1] as () => void;
  click();
  expect(api).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  click();
  await pending;
  expect(api).toHaveBeenCalledWith("/api/competitions", {
    action: "set-enabled",
    id: "league-id",
    version: 1,
    enabled: true,
  });
  expect(elements.some((element) => element.textContent.includes("<img src=x>"))).toBe(true);
});

it("enables a named checklist league without the administrator entering its ID", async () => {
  const handlers = new Map<string, (event: { preventDefault(): void; submitter: object }) => void>();
  const fields = new Map<string, {
    value: string;
    hidden?: boolean;
    replaceChildren(): void;
    append(): void;
    querySelectorAll(): { value: string }[];
    addEventListener(event: string, handler: (event: { preventDefault(): void; submitter: object }) => void): void;
  }>();
  const byId = (id: string) => {
    if (!fields.has(id)) fields.set(id, {
      value: id === "popular-season" ? "2026" : "",
      replaceChildren() {}, append() {},
      querySelectorAll: () => id === "popular-league-list" ? [{ value: "140" }] : [],
      addEventListener: (event, handler) => handlers.set(id + ":" + event, handler),
    });
    return fields.get(id)!;
  };
  const api = vi.fn((_path: string, input?: { action?: string }) => {
    if (input?.action === "add") return { item: { id: "new-league", sourceId: "140", season: 2026, enabled: false, coverageVersion: 1 } };
    if (input?.action === "set-enabled") return { item: { id: "new-league", sourceId: "140", season: 2026, enabled: true, coverageVersion: 2 } };
    return { items: [] };
  });
  let pending: Promise<unknown> | undefined;
  runInNewContext(leagueScript, {
    document: { createElement: () => ({ append() {}, replaceWith() {}, addEventListener() {} }) },
    currentRole: "admin",
    byId, api, confirm: () => true, notice: vi.fn(),
    loadDashboard: vi.fn().mockResolvedValue(undefined),
    busy: (_button: object, work: () => Promise<unknown>) => { pending = work(); },
  });
  handlers.get("popular-league-form:submit")!({ preventDefault() {}, submitter: {} });
  await pending;
  expect(api).toHaveBeenCalledWith("/api/competitions", {
    action: "add", name: "La Liga", sourceId: "140", season: 2026,
  });
  expect(api).toHaveBeenCalledWith("/api/competitions", {
    action: "set-enabled", id: "new-league", version: 1, enabled: true,
  });
});
