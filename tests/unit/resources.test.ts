import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  disconnectDatabase: vi.fn(),
  createPrisma: vi.fn(),
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
  migrate:
    vi.fn<
      (
        file: string,
        args: string[],
        options: { env: NodeJS.ProcessEnv },
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => void
    >(),
}));

vi.mock("@fcp/database", () => ({ createPrisma: mocks.createPrisma }));
vi.mock("node:child_process", () => ({ execFile: mocks.migrate }));
vi.mock("ioredis", () => ({
  Redis: class {
    on() {
      return this;
    }
    connect = mocks.connectRedis;
    disconnect = mocks.disconnectRedis;
    ping = vi.fn().mockResolvedValue("PONG");
    get = vi.fn().mockResolvedValue(null);
    eval = vi.fn().mockResolvedValue([1, 60]);
    del = vi.fn().mockResolvedValue(1);
  },
}));

import { createTestResources } from "../support/resources.js";

const env = {
  TEST_DATABASE_URL: "postgresql://test:test@localhost/football_test",
  TEST_REDIS_URL: "redis://localhost/1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReset().mockResolvedValue(0);
  mocks.disconnectDatabase.mockResolvedValue(undefined);
  mocks.connectRedis.mockReset().mockResolvedValue(undefined);
  mocks.createPrisma.mockReturnValue({
    $executeRawUnsafe: mocks.query,
    $disconnect: mocks.disconnectDatabase,
  });
  mocks.migrate
    .mockReset()
    .mockImplementation((_file, _args, _options, callback) =>
      callback(null, "", ""),
    );
});

describe("isolated resource lifecycle", () => {
  it("rejects unsafe settings before constructing clients", async () => {
    await expect(createTestResources({})).rejects.toThrow("TEST_DATABASE_URL");
    expect(mocks.createPrisma).not.toHaveBeenCalled();
    expect(mocks.connectRedis).not.toHaveBeenCalled();
  });

  it("migrates and cleans exactly its freshly created schema", async () => {
    const resources = await createTestResources(env);
    expect(mocks.query).toHaveBeenCalledWith(
      `CREATE SCHEMA "${resources.namespace}"`,
    );
    expect(mocks.createPrisma).toHaveBeenCalledWith(env.TEST_DATABASE_URL, {
      schema: resources.namespace,
      connectionTimeoutMillis: 5000,
    });
    const migration = mocks.migrate.mock.calls[0];
    expect(migration).toBeDefined();
    const url = new URL(migration![2].env.DATABASE_URL!);
    expect(url.searchParams.get("schema")).toBe(resources.namespace);
    await resources.cleanup();
    await resources.cleanup();
    expect(mocks.query.mock.calls).toEqual([
      [`CREATE SCHEMA "${resources.namespace}"`],
      [`DROP SCHEMA "${resources.namespace}" CASCADE`],
    ]);
    expect(mocks.disconnectDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.disconnectRedis).toHaveBeenCalledTimes(1);
  });

  it("never drops a schema it failed to create", async () => {
    mocks.query.mockRejectedValueOnce(new Error("schema already exists"));
    await expect(createTestResources(env)).rejects.toThrow(
      "schema already exists",
    );
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.disconnectDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.connectRedis).not.toHaveBeenCalled();
  });

  it("cleans its schema when Redis connection fails", async () => {
    mocks.connectRedis.mockRejectedValueOnce(new Error("Redis unavailable"));
    await expect(createTestResources(env)).rejects.toThrow("Redis unavailable");
    expect(mocks.query.mock.calls[1]?.[0]).toMatch(
      /^DROP SCHEMA "fcp_test_[a-f0-9]{32}" CASCADE$/,
    );
    expect(mocks.disconnectDatabase).toHaveBeenCalledTimes(1);
  });

  it("cleans partial migrations and does not echo CLI credentials", async () => {
    mocks.migrate.mockImplementationOnce((_file, _args, _options, callback) =>
      callback(
        new Error("postgresql://secret:password@localhost/football_test"),
        "",
        "",
      ),
    );
    await expect(createTestResources(env)).rejects.toThrow(
      "Isolated test migration failed",
    );
    expect(mocks.query.mock.calls[1]?.[0]).toMatch(
      /^DROP SCHEMA "fcp_test_[a-f0-9]{32}" CASCADE$/,
    );
    expect(mocks.disconnectDatabase).toHaveBeenCalledTimes(1);
  });
});
