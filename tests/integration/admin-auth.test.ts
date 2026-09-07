import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { changeAlertRecipient, listAlertRecipients } from "@fcp/database";
import { createTestResources } from "../support/resources.js";
import { testAdminConfig } from "../support/admin.js";
import { buildAdmin } from "../../apps/admin/src/app.js";
import {
  adminAuth,
  hash,
  secret,
  type AuthRedis,
} from "../../apps/admin/src/auth.js";
const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("admin authentication with isolated Redis and PostgreSQL", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  let redis: AuthRedis;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
    redis = {
      get: (key) => resources.redis.get(key),
      set: (key, value, _mode, ttl) =>
        resources.redis.eval(
          "return redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])",
          1,
          key,
          value,
          ttl,
        ),
      del: async (key) =>
        Number(
          await resources.redis.eval(
            "return redis.call('DEL', KEYS[1])",
            1,
            key,
          ),
        ),
      eval: (...args) => resources.redis.eval(...args),
    };
  }, 90000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30000);
  it("atomically redeems one link, checks expiry, and persists only session-derived actors", async () => {
    const config = testAdminConfig();
    const auth = adminAuth(redis, config);
    const browser = secret();
    const token = await auth.issue("admin@example.com", browser);
    expect(await auth.redeem(token, secret())).toBeNull();
    const consumed = await Promise.all([
      auth.redeem(token, browser),
      auth.redeem(token, browser),
    ]);
    expect(consumed.filter(Boolean)).toHaveLength(1);
    const session = consumed.find(Boolean)!;
    const prefix = `${config.ADMIN_NAMESPACE}:${hash(config.origin)}:admin`;
    const key = `${prefix}:session:${hash(session)}`;
    expect(
      Number(await redis.eval("return redis.call('TTL', KEYS[1])", 1, key)),
    ).toBeGreaterThan(28790);
    const { prisma } = resources;
    const app = buildAdmin({
      config,
      redis,
      store: {
        list: (after) => listAlertRecipients(prisma, after),
        change: (input) => changeAlertRecipient(prisma, input),
        history: (id) =>
          prisma.alertRecipientAudit.findMany({
            where: { recipientId: id },
            take: 100,
          }),
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/recipients",
        headers: {
          origin: config.origin,
          "x-admin-request": "1",
          cookie: `__Host-fcp_admin=${session}`,
        },
        payload: {
          action: "add",
          actor: "forged@example.com",
          settings: {
            email: "alerts@example.com",
            enabled: true,
            warnings: true,
            critical: true,
            recovery: true,
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(await prisma.alertRecipientAudit.findFirst()).toMatchObject({
        actor: "admin@example.com",
        action: "add",
      });
      await redis.eval("return redis.call('PEXPIRE', KEYS[1], 0)", 1, key);
      expect(await auth.identity(session)).toBeNull();
      const expired = await auth.issue("admin@example.com", browser);
      await redis.eval(
        "return redis.call('PEXPIRE', KEYS[1], 0)",
        1,
        `${prefix}:link:${hash(expired)}`,
      );
      expect(await auth.redeem(expired, browser)).toBeNull();
    } finally {
      await app.close();
    }
  });
});
