import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { PrismaClient, RateLimitRedis } from "@fcp/database";
import type * as DatabaseLibrary from "@fcp/database";
import { createLogger, loadConfig, type AppConfig } from "@fcp/shared";
import { buildApp } from "./app.js";
import { verificationGate } from "./security.js";

const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@fcp/database", async (original) => ({
  ...(await original<typeof DatabaseLibrary>()),
  verifyApiKeyHash: mocks.verify,
}));
const token = `fcp_abcdefghijkl_${"x".repeat(43)}`;
const headers = { authorization: `Bearer ${token}` };
const environment = {
  DATABASE_URL: "postgresql://unused:unused@localhost:1/unused",
  REDIS_URL: "redis://localhost:1",
  API_FOOTBALL_BASE_URL: "https://example.invalid",
  API_FOOTBALL_KEY: "unused",
  CURSOR_SIGNING_SECRET: "test-secret-at-least-thirty-two-characters",
};
const applications: Awaited<ReturnType<typeof buildApp>>[] = [];

async function harness(overrides: Partial<AppConfig> = {}) {
  const lookup = vi.fn().mockResolvedValue({
    id: "client",
    keyHash: "hash",
    status: "enabled",
    revokedAt: null,
    rateLimit: 120,
  });
  const log = vi.fn().mockResolvedValue({});
  const evalCommand = vi
    .fn<RateLimitRedis["eval"]>()
    .mockResolvedValue([1, 60]);
  const app = await buildApp({
    config: { ...loadConfig(environment), ...overrides },
    logger: createLogger("silent"),
    prisma: {
      apiClient: { findUnique: lookup },
      apiRequestLog: { create: log },
      competition: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient,
    redis: {
      eval: evalCommand,
      ping: () => Promise.resolve("PONG"),
      get: () => Promise.resolve(null),
    },
  });
  applications.push(app);
  return { app, lookup, log, evalCommand };
}
beforeEach(() => {
  mocks.verify.mockReset().mockResolvedValue(true);
});
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

describe("API authentication admission controls", () => {
  it("rejects excess IP attempts before lookup, hashing, or database logging", async () => {
    const { app, lookup, log, evalCommand } = await harness();
    evalCommand.mockResolvedValueOnce([601, 60]);
    const response = await app.inject({ url: "/v1/competitions", headers });
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("60");
    expect(lookup).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
  it("rejects excess prefix attempts before lookup and hashing", async () => {
    const { app, lookup, evalCommand } = await harness();
    evalCommand.mockResolvedValueOnce([1, 60]).mockResolvedValueOnce([601, 60]);
    expect(
      (await app.inject({ url: "/v1/competitions", headers })).statusCode,
    ).toBe(429);
    expect(lookup).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("fails closed on Redis errors without leaking details", async () => {
    const { app, lookup, evalCommand } = await harness();
    evalCommand.mockRejectedValueOnce(new Error("redis://secret-connection"));
    const response = await app.inject({ url: "/v1/competitions", headers });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.body).not.toContain("secret-connection");
    expect(lookup).not.toHaveBeenCalled();
  });
  it("ignores spoofed forwarding headers by default", async () => {
    const { app, evalCommand } = await harness();
    for (const forwarded of ["198.51.100.1", "198.51.100.2"])
      await app.inject({
        url: "/v1/feed",
        remoteAddress: "192.0.2.10",
        headers: { "x-forwarded-for": forwarded },
      });
    const expected = `rate-limit:auth:ip:${createHash("sha256").update("192.0.2.10").digest("hex")}`;
    expect(evalCommand.mock.calls.map((call) => call[2])).toEqual([
      expected,
      expected,
    ]);
  });
  it("honors the nearest untrusted IP only behind an allowlisted proxy", async () => {
    const { app, evalCommand } = await harness({
      API_TRUSTED_PROXIES: ["127.0.0.1/32"],
    });
    await app.inject({
      url: "/v1/feed",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.99, 192.0.2.10" },
    });
    expect(evalCommand.mock.calls[0]?.[2]).toBe(
      `rate-limit:auth:ip:${createHash("sha256").update("192.0.2.10").digest("hex")}`,
    );
  });
  it("keeps partner quotas after verification and namespaces all counters", async () => {
    const { app, log, evalCommand } = await harness({
      QUEUE_PREFIX: "preview",
    });
    const response = await app.inject({ url: "/v1/competitions", headers });
    expect(response.statusCode).toBe(200);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(evalCommand.mock.calls.map((call) => call[2])).toEqual([
      expect.stringMatching(/^rate-limit:preview:auth:ip:/),
      "rate-limit:preview:auth:prefix:abcdefghijkl",
      "rate-limit:preview:client",
    ]);
  });
  it("does not exempt lookalike documentation routes", async () => {
    const { app, lookup } = await harness();
    expect((await app.inject({ url: "/docsevil" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/docs/json?test=1" })).statusCode).toBe(
      200,
    );
    expect(lookup).not.toHaveBeenCalled();
  });
  it("rejects oversized keys before lookup or hashing", async () => {
    const { app, lookup } = await harness();
    expect(
      (
        await app.inject({
          url: "/v1/feed",
          headers: { authorization: `Bearer ${token}${"x".repeat(512)}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("caps in-flight verification and frees the slot after rejection", async () => {
    const gate = verificationGate(1);
    let reject!: (error: Error) => void;
    const first = gate(
      () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const observed = expect(first).rejects.toThrow("failed hash");
    await expect(gate(() => Promise.resolve(true))).rejects.toMatchObject({
      code: "AUTH_CAPACITY_EXCEEDED",
    });
    reject(new Error("failed hash"));
    await observed;
    await expect(gate(() => Promise.resolve(true))).resolves.toBe(true);
  });
  it.each(["true", "1", "0.0.0.0/0", "::/0", "127.0.0.1/99", "hostname"])(
    "rejects unsafe proxy config %s",
    (value) => {
      expect(() =>
        loadConfig({ ...environment, API_TRUSTED_PROXIES: value }),
      ).toThrow("API_TRUSTED_PROXIES");
    },
  );
});
