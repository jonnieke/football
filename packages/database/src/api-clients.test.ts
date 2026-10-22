import { expect, it, vi } from "vitest";
import { apiClientChangeSchema, createApiClient, listApiClients, revokeApiClient } from "./api-clients.js";
import { verifyApiKeyHash } from "./auth.js";
import type { PrismaClient } from "./generated/prisma/client.ts";

it("creates a one-time API key while storing only its hash", async () => {
  type CreateArgs = {
    data: { id: string; name: string; slug: string; keyPrefix: string; keyHash: string; rateLimit: number };
    select: Record<string, boolean>;
  };
  const create = vi.fn<(args: CreateArgs) => Promise<unknown>>().mockImplementation(({ data }) => Promise.resolve({
    id: data.id,
    name: data.name,
    slug: data.slug,
    status: "enabled",
    keyPrefix: data.keyPrefix,
    rateLimit: data.rateLimit,
    createdAt: new Date(),
    revokedAt: null,
  }));
  const prisma = { apiClient: { create } } as unknown as PrismaClient;
  const result = await createApiClient(prisma, {
    action: "create",
    name: "Ball Mtaani Newsroom",
    rateLimit: 120,
  });
  const data = create.mock.calls[0]![0].data;
  expect(result.client.slug).toMatch(/^ball-mtaani-newsroom-/);
  expect(result.plaintext).toMatch(/^fcp_/);
  expect(data.keyHash).not.toBe(result.plaintext);
  expect(await verifyApiKeyHash(data.keyHash, result.plaintext)).toBe(true);
  expect(JSON.stringify(result.client)).not.toContain(result.plaintext);
  expect(create.mock.calls[0]![0].select.keyHash).toBeUndefined();
});

it("lists metadata without hashes and revokes only an enabled key", async () => {
  const findMany = vi.fn<(args: { select: Record<string, boolean> }) => Promise<unknown>>().mockResolvedValue([]);
  const updateMany = vi.fn<(args: { where: { id: string; status: string; revokedAt: null } }) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
  const findUniqueOrThrow = vi.fn().mockResolvedValue({ status: "revoked" });
  const prisma = {
    apiClient: { findMany, updateMany, findUniqueOrThrow },
  } as unknown as PrismaClient;
  await listApiClients(prisma);
  expect(findMany.mock.calls[0]![0].select.keyHash).toBeUndefined();
  await revokeApiClient(prisma, "11111111-1111-4111-8111-111111111111");
  expect(updateMany.mock.calls[0]![0].where).toEqual({
    id: "11111111-1111-4111-8111-111111111111",
    status: "enabled",
    revokedAt: null,
  });
  updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(
    revokeApiClient(prisma, "11111111-1111-4111-8111-111111111111"),
  ).rejects.toThrow("already revoked");
});

it("rejects forged fields and unbounded client rate limits", () => {
  expect(() =>
    apiClientChangeSchema.parse({
      action: "create",
      name: "Example",
      rateLimit: 120,
      plaintext: "forged",
    }),
  ).toThrow();
  expect(() =>
    apiClientChangeSchema.parse({
      action: "create",
      name: "Example",
      rateLimit: 1001,
    }),
  ).toThrow();
});
