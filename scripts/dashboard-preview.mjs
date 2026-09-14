// Offline UI preview only. No credentials, database, Redis, or email connections.
import { createServer } from "node:http";
import { setTimeout } from "node:timers";
import {
  page,
  operationsStylesheet,
  browserScript,
} from "../apps/admin/src/ui.ts";
const snapshot = {
  observedAt: new Date().toISOString(),
  namespace: "DEMO_ONLY",
  database: "Demo — not connected",
  redis: "Demo — not connected",
  workers: [
    "football-ingestion",
    "outbox-dispatcher",
    "event-processor",
    "content-generator",
  ].map((name) => ({ name, state: "unknown", lastSeen: null })),
  data: {
    competitions: [
      { name: "Premier League (example)", season: 2026, country: "England" },
    ],
    polls: [],
    fixtures: [],
    content: [],
    pending: 0,
    paused: 0,
    reviews: 0,
  },
  quota: {
    remaining: null,
    note: "Offline preview. No API requests are made.",
  },
};
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  if (request.method !== "GET") {
    response.writeHead(403);
    response.end('{"error":"Offline preview: all changes disabled"}');
    return;
  }
  const routes = {
    "/": [
      "text/html",
      page.replace(
        "Know what is happening.",
        "Dashboard preview — example data.",
      ),
    ],
    "/admin.css": ["text/css", operationsStylesheet],
    "/admin.js": ["application/javascript", browserScript],
    "/api/session": [
      "application/json",
      JSON.stringify({
        email: "Offline preview — not signed into a live account",
      }),
    ],
    "/api/recipients": ["application/json", '{"items":[]}'],
    "/api/content/drafts": [
      "application/json",
      JSON.stringify({
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            fingerprint: "a".repeat(64),
            match: "Example Home v Example Away",
            eventType: "goal",
            kickoffAt: "2026-09-14T12:00:00Z",
            standardText: "EXAMPLE ONLY — GOAL! Example Home 1-0 Example Away.",
            shortText: "EXAMPLE ONLY — Goal, 1-0.",
          },
        ],
      }),
    ],
    "/api/content/history": ["application/json", '{"items":[]}'],
    "/api/dashboard": ["application/json", JSON.stringify(snapshot)],
  };
  const route = routes[request.url];
  if (!route) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader("Content-Type", route[0]);
  response.end(route[1]);
});
server.listen(3187, "127.0.0.1", () =>
  console.log(
    "OFFLINE_PREVIEW http://127.0.0.1:3187 (automatic stop in 15 minutes)",
  ),
);
setTimeout(() => {
  server.close();
  server.closeAllConnections();
}, 900000).unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
