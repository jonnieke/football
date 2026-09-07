import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  databaseDisconnect: vi.fn(),
  ready: vi.fn(),
  emit: vi.fn(),
  build: vi.fn(),
  config: vi.fn(),
}));
vi.mock("@fcp/database", () => ({
  getPrisma: () => ({ $disconnect: mocks.databaseDisconnect }),
}));
vi.mock("@fcp/shared", () => ({
  loadConfig: mocks.config,
  createLogger: () => ({ warn: vi.fn() }),
  createProducerRedis: () => ({
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    on: vi.fn(),
  }),
}));
vi.mock("./app.js", () => ({ buildApp: mocks.build }));

describe("Vercel request adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.config.mockReturnValue({
      DATABASE_URL: "unused",
      REDIS_URL: "unused",
      LOG_LEVEL: "silent",
    });
    mocks.build.mockResolvedValue({
      ready: mocks.ready,
      server: { emit: mocks.emit },
    });
  });
  it("shares initialization across concurrent requests without opening a listener", async () => {
    const { default: handler } = await import("./handler.js");
    const request = { url: "/v1/feed?limit=1" } as IncomingMessage;
    const response = {} as ServerResponse;
    await Promise.all([handler(request, response), handler(request, response)]);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.build).toHaveBeenCalledTimes(1);
    expect(mocks.ready).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledTimes(2);
    expect(mocks.emit).toHaveBeenCalledWith("request", request, response);
  });
  it("cleans up failed initialization and retries on the next request", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("Redis unavailable"));
    const { default: handler } = await import("./handler.js");
    await expect(
      handler({} as IncomingMessage, {} as ServerResponse),
    ).rejects.toThrow("Redis unavailable");
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.databaseDisconnect).toHaveBeenCalledTimes(1);
    await handler({} as IncomingMessage, {} as ServerResponse);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });
});
