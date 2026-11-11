import { Script } from "node:vm";
import { expect, it } from "vitest";
import { preMatchHtml, preMatchScript, preMatchCss } from "./pre-match-ui.js";
import { browserScript } from "./ui.js";

it("validates pre-match UI template and script safety", () => {
  expect(() => new Script(browserScript)).not.toThrow();
  expect(preMatchHtml).toContain("Pre-Match Score Notification Approvals");
  expect(preMatchHtml).toContain("Matches approved");
  expect(preMatchHtml).toContain("Per-game limit");
  expect(preMatchHtml).toContain("Midnight EAT");
  expect(preMatchHtml).toContain("pre-match-date");
  expect(preMatchScript).not.toMatch(/innerHTML|insertAdjacentHTML/);
  expect(preMatchScript).toContain("pm-greyed");
  expect(preMatchCss).toContain(".pm-greyed");
});
