import { describe, expect, it, vi } from "vitest";
import {
  IsolatedRedis,
  newTestNamespace,
  schemaIdentifier,
  testEndpoints,
} from "../support/isolation.js";

const valid = {
  TEST_DATABASE_URL:
    "postgresql://test:test@127.0.0.1:5432/football_content_test",
  TEST_REDIS_URL: "redis://127.0.0.1:6379/1",
};

describe("integration resource guards", () => {
  it("accepts explicit local test stores", () => {
    expect(testEndpoints(valid).databaseUrl).toBe(valid.TEST_DATABASE_URL);
  });
  it("never falls back to application credentials", () => {
    expect(() =>
      testEndpoints({
        DATABASE_URL: valid.TEST_DATABASE_URL,
        REDIS_URL: valid.TEST_REDIS_URL,
      }),
    ).toThrow("TEST_DATABASE_URL is required");
  });
  it.each([
    "postgresql://secret:secret@production.example/football_test",
    "postgresql://test:test@localhost/football_content",
    "postgresql://test:test@localhost/contest",
    "postgresql://test:test@localhost/football_test?schema=public",
    "postgresql://test:test@localhost/football_test?host=production.example",
  ])(
    "rejects unsafe database targets without exposing credentials: %s",
    (url) => {
      expect(() =>
        testEndpoints({ ...valid, TEST_DATABASE_URL: url }),
      ).toThrow();
      try {
        testEndpoints({ ...valid, TEST_DATABASE_URL: url });
      } catch (error) {
        expect(String(error)).not.toContain(url);
      }
    },
  );
  it.each([
    "redis://localhost",
    "redis://localhost/0",
    "redis://remote.example/1",
    "redis://localhost/1?db=0",
  ])("rejects unsafe Redis targets: %s", (url) => {
    expect(() => testEndpoints({ ...valid, TEST_REDIS_URL: url })).toThrow();
  });
  it("rejects an application store even when loopback names and credentials differ", () => {
    expect(() =>
      testEndpoints({
        ...valid,
        DATABASE_URL: "postgresql://other@localhost/football_content_test",
      }),
    ).toThrow("must differ");
    expect(() =>
      testEndpoints({ ...valid, REDIS_URL: "redis://localhost/1" }),
    ).toThrow("must differ");
  });
  it("generates distinct, strictly validated schema names", () => {
    const first = newTestNamespace();
    expect(first).not.toBe(newTestNamespace());
    expect(schemaIdentifier(first)).toBe(`"${first}"`);
    expect(() => schemaIdentifier("public")).toThrow();
    expect(() =>
      schemaIdentifier('fcp_test_"; DROP SCHEMA public CASCADE;--'),
    ).toThrow();
  });
});

describe("Redis key isolation", () => {
  it("prefixes every Lua key and deletes only exact touched keys", async () => {
    const backend = {
      ping: vi.fn().mockResolvedValue("PONG"),
      get: vi.fn().mockResolvedValue(null),
      eval: vi.fn().mockResolvedValue([1, 60]),
      del: vi.fn().mockResolvedValue(1),
    };
    const namespace = newTestNamespace();
    const redis = new IsolatedRedis(backend, namespace);
    await redis.eval("script", 2, "one", "two", 60);
    await redis.get("health:worker:football-ingestion");
    expect(backend.eval).toHaveBeenCalledWith(
      "script",
      2,
      `${namespace}:one`,
      `${namespace}:two`,
      60,
    );
    await redis.cleanup();
    expect(backend.del.mock.calls).toEqual([
      [`${namespace}:one`],
      [`${namespace}:two`],
      [`${namespace}:health:worker:football-ingestion`],
    ]);
    await redis.cleanup();
    expect(backend.del).toHaveBeenCalledTimes(3);
  });
  it("does not delete anything when no key was touched", async () => {
    const backend = {
      ping: vi.fn().mockResolvedValue("PONG"),
      get: vi.fn().mockResolvedValue(null),
      eval: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(0),
    };
    await new IsolatedRedis(backend, newTestNamespace()).cleanup();
    expect(backend.del).not.toHaveBeenCalled();
  });
});
