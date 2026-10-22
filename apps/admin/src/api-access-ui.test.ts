import { expect, it } from "vitest";
import { apiAccessHtml, apiAccessScript } from "./api-access-ui.js";

it("labels API keys as one-time secrets and avoids HTML injection", () => {
  expect(apiAccessHtml).toContain("it will not be shown again");
  expect(apiAccessHtml).toContain("Do not put it in a slide");
  expect(apiAccessScript).not.toMatch(/innerHTML|insertAdjacentHTML|localStorage/);
  expect(apiAccessScript).toContain("textContent=result.plaintext");
});
