// Synthetic UI verification only. Never imported by the production admin entry point.
import { randomUUID } from "node:crypto";
import { buildAdmin } from "../apps/admin/src/app.js";
import { memoryAuthRedis, testAdminConfig } from "../tests/support/admin.js";
import { recipientChangeSchema } from "@fcp/database";
const origin = "http://127.0.0.1:3847";
const items = [
  {
    id: randomUUID(),
    email: "operations@example.com",
    enabled: true,
    warnings: true,
    critical: true,
    recovery: true,
    version: 1,
  },
];
const history: unknown[] = [];
let lastToken = "";
const app = buildAdmin({
  config: testAdminConfig(origin),
  redis: memoryAuthRedis(),
  send: (_email, token) => {
    lastToken = token;
    return Promise.resolve();
  },
  store: {
    list: () => Promise.resolve(items),
    history: () => Promise.resolve(history),
    change: (input) => {
      const change = recipientChangeSchema.parse(input);
      if (change.action === "add") {
        const item = { id: randomUUID(), ...change.settings, version: 1 };
        items.push(item);
        history.push({ action: change.action, actor: change.actor });
        return Promise.resolve(item);
      }
      const index = items.findIndex(
        (item) => item.id === change.id && item.version === change.version,
      );
      if (index < 0)
        return Promise.reject(
          new Error("Recipient changed; reload before editing"),
        );
      const previous = items[index]!;
      if (change.action === "remove") {
        items.splice(index, 1);
        return Promise.resolve(null);
      }
      const item = {
        ...previous,
        ...change.settings,
        version: previous.version + 1,
      };
      items[index] = item;
      history.push({
        action: change.action,
        actor: change.actor,
        before: previous,
        after: item,
      });
      return Promise.resolve(item);
    },
  },
});
// Local fake inbox: contains only synthetic, in-memory preview credentials.
app.get("/preview-inbox", () => ({
  url: `${origin}/auth/confirm#token=${lastToken}`,
}));
await app.listen({ host: "127.0.0.1", port: 3847 });
console.log(
  "Synthetic admin preview on http://127.0.0.1:3847/login; no external services connected.",
);
