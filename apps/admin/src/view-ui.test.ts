import { runInNewContext, Script } from "node:vm";
import { expect, it, vi } from "vitest";
import { viewScript } from "./view-ui.js";
import { browserScript, page } from "./ui.js";

it("renders separate daily views and keeps technical data behind More", () => {
  expect(() => new Script(browserScript)).not.toThrow();
  for (const name of ["alerts", "leagues", "inboxes", "more"]) {
    expect(page).toContain(`id="view-${name}"`);
    expect(page).toContain(`id="tab-${name}"`);
  }
  expect(page).toContain("Platform status and data");
  expect(page).toContain('id="tab-api"');
  expect(page).toContain('id="tab-matches"');
});

it("loads only the selected view and stops live polling when leaving it", async () => {
  const handlers = new Map<
    string,
    (event: { target: { open: boolean } }) => void
  >();
  const nodes = new Map<
    string,
    {
      hidden: boolean;
      tabIndex: number;
      setAttribute(name: string, value: string): void;
      addEventListener(
        name: string,
        handler: (event: { target: { open: boolean } }) => void,
      ): void;
      focus(): void;
      click(): void;
    }
  >();
  const byId = (id: string) => {
    if (!nodes.has(id))
      nodes.set(id, {
        hidden: id !== "view-alerts",
        tabIndex: 0,
        setAttribute: vi.fn(),
        addEventListener: (name, handler) =>
          handlers.set(id + ":" + name, handler),
        focus() {},
        click() {},
      });
    return nodes.get(id)!;
  };
  const startLiveFeed = vi.fn().mockResolvedValue(undefined);
  const suspendLiveFeed = vi.fn();
  const loadLeagues = vi.fn().mockResolvedValue(undefined);
  const loadRecipients = vi.fn().mockResolvedValue(undefined);
  const loadDashboard = vi.fn().mockResolvedValue(undefined);
  const views = runInNewContext(viewScript + ";({showView,viewFromHash})", {
    byId,
    location: { hash: "" },
    window: { addEventListener() {} },
    startLiveFeed,
    suspendLiveFeed,
    loadLeagues,
    load: loadRecipients,
    loadDashboard,
    loadApiClients: vi.fn(),
    loadDrafts: vi.fn(),
    loadApprovalHistory: vi.fn(),
    loadEmailActivity: vi.fn(),
    loadLeagueHistory: vi.fn(),
    notice: vi.fn(),
  }) as {
    showView: (name: string) => Promise<void>;
    viewFromHash: () => string;
  };
  expect(views.viewFromHash()).toBe("alerts");
  await views.showView("alerts");
  expect(startLiveFeed).toHaveBeenCalledTimes(1);
  expect(loadLeagues).not.toHaveBeenCalled();
  expect(loadDashboard).not.toHaveBeenCalled();
  await views.showView("leagues");
  expect(suspendLiveFeed).toHaveBeenCalledTimes(1);
  expect(loadLeagues).toHaveBeenCalledTimes(1);
  expect(byId("view-alerts").hidden).toBe(true);
  await views.showView("inboxes");
  expect(loadRecipients).toHaveBeenCalledTimes(1);
  await views.showView("more");
  expect(loadDashboard).not.toHaveBeenCalled();
  handlers.get("more-ops:toggle")!({ target: { open: true } });
  await Promise.resolve();
  expect(loadDashboard).toHaveBeenCalledTimes(1);
});
