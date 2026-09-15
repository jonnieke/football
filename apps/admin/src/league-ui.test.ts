import { Script, runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { leagueHtml, leagueScript } from "./league-ui.js";
import { browserScript } from "./ui.js";

it("ships valid browser code with paused onboarding and no unsafe HTML insertion", () => {
  expect(() => new Script(browserScript)).not.toThrow();
  expect(leagueHtml).toContain("Add paused league");
  expect(leagueHtml).toContain("does not verify provider coverage");
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
    byId: () => ({ addEventListener() {}, replaceChildren() {} }),
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
  expect(elements[1]?.textContent).toContain("<img src=x>");
});
