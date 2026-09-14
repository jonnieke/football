import { expect, it, vi } from "vitest";
import { createAdminRedis, redisFailureReason } from "./redis.js";
import {
  memoryAuthRedis,
  testAdminConfig,
} from "../../../tests/support/admin.js";
import { buildAdmin } from "./app.js";

function fixture() {
  const data = memoryAuthRedis();
  const newClient = () => ({
    ...data,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    on: vi.fn(),
  });
  const clients: ReturnType<typeof newClient>[] = [];
  const factory = () => {
    const client = newClient();
    clients.push(client);
    return client;
  };
  return { clients, factory, manager: createAdminRedis("unused", factory) };
}

it("shares concurrent requests but reconnects after every idle period", async () => {
  const { manager, clients } = fixture();
  const a = manager.acquire();
  const b = manager.acquire();
  await Promise.all([a.ready, b.ready]);
  expect(clients).toHaveLength(1);
  a.release();
  expect(clients[0]!.disconnect).not.toHaveBeenCalled();
  b.release();
  b.release();
  expect(clients[0]!.disconnect).toHaveBeenCalledTimes(1);
  const c = manager.acquire();
  await c.ready;
  expect(clients).toHaveLength(2);
  c.release();
});

it("releases failed requests and recovers on the next request without sending mail", async () => {
  const { factory, clients } = fixture();
  let first = true;
  const manager = createAdminRedis("unused", () => {
    const client = factory();
    if (first)
      client.connect.mockRejectedValueOnce(new Error("private-secret"));
    first = false;
    return client;
  });
  const send = vi.fn();
  const app = buildAdmin({
    config: testAdminConfig(),
    redis: manager.redis,
    acquireRedis: () => manager.acquire(),
    send,
    store: {
      list: () => Promise.resolve([]),
      change: () => Promise.resolve({}),
      history: () => Promise.resolve([]),
    },
  });
  try {
    const failed = await app.inject("/api/dashboard");
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain("private-secret");
    expect(clients[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect((await app.inject("/api/dashboard")).statusCode).toBe(401);
    expect(clients[1]!.disconnect).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  } finally {
    await app.close();
    manager.close();
  }
});

it("does not replay a failed one-time token command", async () => {
  const { manager, clients } = fixture();
  const lease = manager.acquire();
  await lease.ready;
  const command = vi
    .spyOn(clients[0]!, "eval")
    .mockRejectedValue(new Error("Connection closed"));
  await expect(manager.redis.eval("consume", 1, "key")).rejects.toThrow();
  expect(command).toHaveBeenCalledTimes(1);
  lease.release();
});

it("logs only allowlisted categories, not secrets or addresses", () => {
  expect(
    redisFailureReason(
      Object.assign(new Error("rediss://secret@private"), {
        code: "ECONNRESET",
      }),
    ),
  ).toBe("ECONNRESET");
  expect(redisFailureReason(new Error("WRONGPASS secret"))).toBe(
    "AUTHENTICATION",
  );
  expect(redisFailureReason(new Error("private-secret"))).toBe("UNKNOWN");
});
