import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createAdminHandler } from "./handler.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
it("retries failed initialization, redacts errors and shares a warm instance", async () => {
  const app = Fastify();
  app.get("/probe", () => ({ ok: true }));
  await app.ready();
  const init = vi
    .fn()
    .mockRejectedValueOnce(new Error("private-connection-secret"))
    .mockResolvedValue(app);
  const handler = createAdminHandler(init);
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await app.close();
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test address");
  const url = `http://127.0.0.1:${address.port}/probe`;
  const failed = await fetch(url);
  expect(failed.status).toBe(503);
  expect(failed.headers.get("cache-control")).toBe("no-store");
  expect(await failed.text()).not.toContain("private-connection-secret");
  const results = await Promise.all([fetch(url), fetch(url)]);
  for (const result of results) {
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
  }
  expect(init).toHaveBeenCalledTimes(2);
}, 15000);
