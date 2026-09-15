import { afterEach, expect, it, vi } from "vitest";
import { buildAdmin } from "./app.js";
import { CompetitionConflict } from "@fcp/database";
import {
  memoryAuthRedis,
  testAdminConfig,
} from "../../../tests/support/admin.js";
const apps: ReturnType<typeof buildAdmin>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup() {
  const config = testAdminConfig();
  const redis = memoryAuthRedis();
  const store = {
    list: vi.fn().mockResolvedValue([]),
    change: vi.fn().mockResolvedValue({}),
    history: vi.fn().mockResolvedValue([]),
  };
  const send = vi
    .fn<(email: string, token: string) => Promise<void>>()
    .mockResolvedValue();
  const dashboard = vi
    .fn()
    .mockResolvedValue({ database: "connected", data: { polls: [] } });
  const content = {
    list: vi.fn().mockResolvedValue([]),
    approve: vi.fn().mockResolvedValue({ status: "published" }),
    history: vi.fn().mockResolvedValue([]),
  };
  const competitions = {
    list: vi.fn().mockResolvedValue([]),
    change: vi.fn().mockResolvedValue({ enabled: false }),
    history: vi.fn().mockResolvedValue([]),
  };
  const liveFeed = vi.fn().mockResolvedValue({ items: [], cursor: "test" });
  const matchEmails = vi.fn().mockResolvedValue([]);
  const app = buildAdmin({
    config,
    redis,
    store,
    send,
    dashboard,
    content,
    competitions,
    liveFeed,
    matchEmails,
  });
  apps.push(app);
  const post = (
    url: string,
    payload: unknown,
    cookie = "",
    origin = config.origin,
  ) =>
    app.inject({
      method: "POST",
      url,
      payload: JSON.stringify(payload),
      headers: {
        origin,
        "x-admin-request": "1",
        "content-type": "application/json",
        cookie,
      },
    });
  const login = async () => {
    const issued = await post("/auth/request", { email: "admin@example.com" });
    const cookie = String(issued.headers["set-cookie"]).split(";")[0]!;
    const token = send.mock.calls.at(-1)![1];
    const confirmed = await post("/auth/redeem", { token }, cookie);
    expect(confirmed.statusCode).toBe(200);
    const cookies = confirmed.headers["set-cookie"] as string[];
    return cookies[0]!.split(";")[0]!;
  };
  return {
    matchEmails,
    liveFeed,
    app,
    config,
    redis,
    store,
    send,
    post,
    login,
    dashboard,
    content,
    competitions,
  };
}
it("protects live updates and validates read positions", async () => {
  const { app, login, post, liveFeed } = setup();
  expect((await app.inject("/api/live-feed")).statusCode).toBe(401);
  expect(liveFeed).not.toHaveBeenCalled();
  const cookie = await login();
  const result = await app.inject({
    url: "/api/live-feed",
    headers: { cookie },
  });
  expect(result.statusCode).toBe(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  for (const query of [
    "after=oops",
    "limit=100000",
    "after=" + "9".repeat(100),
  ])
    expect(
      (
        await app.inject({
          url: "/api/live-feed?" + query,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(400);
  expect(liveFeed).toHaveBeenCalledTimes(1);
  await post("/auth/logout", {}, cookie);
  expect(
    (await app.inject({ url: "/api/live-feed", headers: { cookie } }))
      .statusCode,
  ).toBe(401);
});
it("keeps match-email status behind the administrator session", async () => {
  const { app, login, matchEmails } = setup();
  expect((await app.inject({ url: "/api/match-emails" })).statusCode).toBe(401);
  expect(matchEmails).not.toHaveBeenCalled();
  const cookie = await login();
  expect(
    (
      await app.inject({ url: "/api/match-emails", headers: { cookie } })
    ).json(),
  ).toEqual({ items: [] });
  expect(matchEmails).toHaveBeenCalledTimes(1);
});
it("protects league controls and derives the audit actor from the session", async () => {
  const { app, post, login, competitions } = setup();
  const input = {
    action: "add",
    sourceId: "39",
    season: 2026,
    name: "Premier League",
  };
  for (const path of ["/api/competitions", "/api/competitions/history"])
    expect((await app.inject(path)).statusCode).toBe(401);
  expect((await post("/api/competitions", input)).statusCode).toBe(401);
  const cookie = await login();
  expect(
    (await post("/api/competitions", input, cookie, "https://evil.example"))
      .statusCode,
  ).toBe(403);
  for (const body of [
    { ...input, actor: "forged@example.com" },
    { ...input, season: 0 },
    { ...input, sourceId: "https://evil.example" },
    { ...input, enabled: true },
  ])
    expect((await post("/api/competitions", body, cookie)).statusCode).toBe(
      400,
    );
  expect(competitions.change).not.toHaveBeenCalled();
  expect((await post("/api/competitions", input, cookie)).statusCode).toBe(200);
  expect(competitions.change).toHaveBeenCalledWith(input, "admin@example.com");
  competitions.change.mockRejectedValueOnce(
    new CompetitionConflict("Reload leagues"),
  );
  expect((await post("/api/competitions", input, cookie)).statusCode).toBe(409);
  expect(
    (
      await app.inject({
        url: "/api/competitions?after=bad",
        headers: { cookie },
      })
    ).statusCode,
  ).toBe(400);
  await post("/auth/logout", {}, cookie);
  expect((await post("/api/competitions", input, cookie)).statusCode).toBe(401);
});
it("requires an approved session and same-origin confirmation for publication", async () => {
  const { app, post, login, content } = setup();
  const input = {
    id: "11111111-1111-4111-8111-111111111111",
    fingerprint: "a".repeat(64),
  };
  expect((await app.inject("/api/content/drafts")).statusCode).toBe(401);
  expect((await app.inject("/api/content/history")).statusCode).toBe(401);
  expect((await post("/api/content/approve", input)).statusCode).toBe(401);
  const cookie = await login();
  expect(
    (await post("/api/content/approve", input, cookie, "https://evil.example"))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await post(
        "/api/content/approve",
        { ...input, actor: "forged@example.com" },
        cookie,
      )
    ).statusCode,
  ).toBe(400);
  expect(content.approve).not.toHaveBeenCalled();
  expect((await post("/api/content/approve", input, cookie)).statusCode).toBe(
    200,
  );
  expect(content.approve).toHaveBeenCalledWith(input, "admin@example.com");
  await post("/auth/logout", {}, cookie);
  expect((await post("/api/content/approve", input, cookie)).statusCode).toBe(
    401,
  );
  expect(content.approve).toHaveBeenCalledTimes(1);
});
it("protects dashboard data, disables caching, redacts failures and revokes access", async () => {
  const { app, login, post, dashboard } = setup();
  expect((await app.inject("/api/dashboard")).statusCode).toBe(401);
  expect(dashboard).not.toHaveBeenCalled();
  const cookie = await login();
  const result = await app.inject({
    url: "/api/dashboard",
    headers: { cookie },
  });
  expect(result.statusCode).toBe(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.json()).toMatchObject({ database: "connected" });
  dashboard.mockRejectedValue(new Error("postgres://private-secret"));
  const failed = await app.inject({
    url: "/api/dashboard",
    headers: { cookie },
  });
  expect(failed.statusCode).toBe(503);
  expect(failed.body).not.toContain("private-secret");
  await post("/auth/logout", {}, cookie);
  expect(
    (await app.inject({ url: "/api/dashboard", headers: { cookie } }))
      .statusCode,
  ).toBe(401);
});
it("rejects unauthorized reads, foreign/missing origins and form submissions", async () => {
  const { app, post, store } = setup();
  expect((await app.inject("/api/recipients")).statusCode).toBe(401);
  expect(
    (
      await post(
        "/auth/request",
        { email: "admin@example.com" },
        "",
        "https://evil.example",
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/auth/request",
        payload: { email: "admin@example.com" },
      })
    ).statusCode,
  ).toBe(403);
  expect(store.list).not.toHaveBeenCalled();
});
it("uses generic login responses and never sends to unapproved recipients", async () => {
  const { post, send } = setup();
  const unknown = await post("/auth/request", {
    email: "stranger@example.com",
  });
  expect(send).not.toHaveBeenCalled();
  const known = await post("/auth/request", { email: "admin@example.com" });
  expect(unknown.body).toBe(known.body);
  expect(known.headers["set-cookie"]).toContain("HttpOnly; SameSite=Strict");
  expect(known.headers["set-cookie"]).toContain("Secure");
});
it("derives audit actor from session, protects history, and revokes on logout", async () => {
  const { app, post, store, login } = setup();
  const cookie = await login();
  const result = await post(
    "/api/recipients",
    {
      action: "add",
      actor: "forged",
      settings: {
        email: "alerts@example.com",
        enabled: true,
        warnings: true,
        critical: true,
        recovery: true,
      },
    },
    cookie,
  );
  expect(result.statusCode).toBe(200);
  expect(store.change.mock.calls[0]![0]).toMatchObject({
    actor: "admin@example.com",
  });
  expect(
    (await app.inject({ url: "/api/recipients", headers: { cookie } }))
      .statusCode,
  ).toBe(200);
  expect(
    (await app.inject("/api/history/00000000-0000-4000-8000-000000000001"))
      .statusCode,
  ).toBe(401);
  await post("/auth/logout", {}, cookie);
  expect(
    (await app.inject({ url: "/api/recipients", headers: { cookie } }))
      .statusCode,
  ).toBe(401);
});
it("does not consume a link on GET and enforces secure browser confirmation", async () => {
  const { app, post, send } = setup();
  const issued = await post("/auth/request", { email: "admin@example.com" });
  const cookie = String(issued.headers["set-cookie"]).split(";")[0]!;
  const token = send.mock.calls[0]![1];
  expect((await app.inject("/auth/confirm")).statusCode).toBe(200);
  expect((await post("/auth/redeem", { token })).statusCode).toBe(401);
  expect((await post("/auth/redeem", { token }, cookie)).statusCode).toBe(200);
  expect((await post("/auth/redeem", { token }, cookie)).statusCode).toBe(401);
});
it("fails closed on Redis errors and limits login delivery", async () => {
  const { post, redis, send } = setup();
  for (let n = 0; n < 4; n++)
    await post("/auth/request", { email: "admin@example.com" });
  expect(send).toHaveBeenCalledTimes(3);
  redis.eval = () => Promise.reject(new Error("secret connection"));
  const failed = await post("/auth/request", { email: "admin@example.com" });
  expect(failed.statusCode).toBe(503);
  expect(failed.body).not.toContain("secret connection");
});
it("invalidates links when Resend rejects delivery", async () => {
  const { post, send } = setup();
  send.mockRejectedValue(new Error("provider secret detail"));
  const issued = await post("/auth/request", { email: "admin@example.com" });
  expect(issued.statusCode).toBe(200);
  expect(issued.body).not.toContain("provider secret detail");
  const cookie = String(issued.headers["set-cookie"]).split(";")[0]!;
  const token = send.mock.calls[0]![1];
  expect((await post("/auth/redeem", { token }, cookie)).statusCode).toBe(401);
});

it("sets security headers and retains edit conflicts", async () => {
  const { app, login, post, store } = setup();
  const page = await app.inject("/login");
  expect(page.headers["cache-control"]).toBe("no-store");
  expect(page.headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  const cookie = await login();
  store.change.mockRejectedValue(
    new Error("Recipient changed; reload before editing"),
  );
  const result = await post(
    "/api/recipients",
    {
      action: "remove",
      id: "00000000-0000-4000-8000-000000000001",
      version: 1,
    },
    cookie,
  );
  expect(result.statusCode).toBe(409);
});
