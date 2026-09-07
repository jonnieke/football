import { afterEach, expect, it, vi } from "vitest";
import { buildAdmin } from "./app.js";
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
  const app = buildAdmin({ config, redis, store, send });
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
  return { app, config, redis, store, send, post, login };
}
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
