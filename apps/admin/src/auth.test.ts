import { afterEach, expect, it, vi } from "vitest";
import { adminAuth, secret, sendLogin } from "./auth.js";
import { adminConfig } from "./config.js";
import {
  memoryAuthRedis,
  testAdminConfig,
} from "../../../tests/support/admin.js";
afterEach(() => vi.useRealTimers());
it("binds links to their requesting browser, consumes once and revokes sessions", async () => {
  const config = testAdminConfig();
  const auth = adminAuth(memoryAuthRedis(), config);
  const browser = secret();
  const token = await auth.issue("admin@example.com", browser);
  expect(await auth.redeem(token, secret())).toBeNull();
  const results = await Promise.all([
    auth.redeem(token, browser),
    auth.redeem(token, browser),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const session = results.find(Boolean)!;
  expect(await auth.identity(session)).toBe("admin@example.com");
  config.admins.clear();
  expect(await auth.identity(session)).toBeNull();
  config.admins.add("admin@example.com");
  await auth.logout(session);
  expect(await auth.identity(session)).toBeNull();
});
it("expires links after ten minutes and sessions after eight hours", async () => {
  vi.useFakeTimers();
  const auth = adminAuth(memoryAuthRedis(), testAdminConfig());
  const browser = secret();
  const token = await auth.issue("admin@example.com", browser);
  vi.advanceTimersByTime(600000);
  expect(await auth.redeem(token, browser)).toBeNull();
  const fresh = await auth.issue("admin@example.com", browser);
  const session = (await auth.redeem(fresh, browser))!;
  vi.advanceTimersByTime(28800000);
  expect(await auth.identity(session)).toBeNull();
});
it("sends only to Resend with bounded requests, stable idempotency and fragment tokens", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 200 }));
  const token = secret();
  await sendLogin(testAdminConfig(), "admin@example.com", token, fetcher);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://api.resend.com/emails");
  expect(options?.redirect).toBe("error");
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  if (typeof options?.body !== "string") throw new Error("Expected JSON body");
  const payload = JSON.parse(options.body) as {
    text: string;
    to: string[];
  };
  expect(payload.to).toEqual(["admin@example.com"]);
  expect(payload.text).toContain(`/auth/confirm#token=${token}`);
  fetcher.mockResolvedValue(
    new Response("sensitive provider details", { status: 403 }),
  );
  await expect(
    sendLogin(testAdminConfig(), "admin@example.com", token, fetcher),
  ).rejects.toThrow("Login email unavailable");
});
it("fails closed on missing allowlists and unsafe origins", () => {
  expect(() => adminConfig({})).toThrow();
  const base = {
    ADMIN_ORIGIN: "http://evil.example",
    ADMIN_NAMESPACE: "test",
    ADMIN_EMAILS: "admin@example.com",
    RESEND_FROM: "login@example.com",
    RESEND_API_KEY: "test-key-not-real",
  };
  expect(() => adminConfig(base)).toThrow();
  expect(() =>
    adminConfig({ ...base, ADMIN_ORIGIN: "https://admin.example/path" }),
  ).toThrow();
  expect(() =>
    adminConfig({
      ...base,
      ADMIN_ORIGIN: "https://admin.example",
      ADMIN_EMAILS: "",
    }),
  ).toThrow();
});
