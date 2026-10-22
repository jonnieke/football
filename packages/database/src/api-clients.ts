import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "./generated/prisma/client.ts";
import { createApiKeyMaterial } from "./auth.js";

export const apiClientChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      name: z.string().trim().min(2).max(100),
      rateLimit: z.number().int().min(1).max(1000),
    })
    .strict(),
  z.object({ action: z.literal("revoke"), id: z.uuid() }).strict(),
]);

export class ApiClientConflict extends Error {}

const publicFields = {
  id: true,
  name: true,
  slug: true,
  status: true,
  keyPrefix: true,
  rateLimit: true,
  createdAt: true,
  revokedAt: true,
} as const;

/** Never return keyHash or the plaintext from a list request. */
export function listApiClients(prisma: PrismaClient) {
  return prisma.apiClient.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: publicFields,
  });
}

/** The plaintext is returned only by this creation call, once. */
export async function createApiClient(
  prisma: PrismaClient,
  input: unknown,
) {
  const change = apiClientChangeSchema.parse(input);
  if (change.action !== "create") throw new Error("Expected create action");
  const material = await createApiKeyMaterial();
  const label = change.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "client";
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  try {
    const client = await prisma.apiClient.create({
      data: {
        id: randomUUID(),
        name: change.name,
        slug,
        keyPrefix: material.prefix,
        keyHash: material.hash,
        rateLimit: change.rateLimit,
      },
      select: publicFields,
    });
    return { client, plaintext: material.plaintext };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ApiClientConflict("Key could not be created. Try again.");
    throw error;
  }
}

/** Revocation takes effect on the next authenticated request. */
export async function revokeApiClient(prisma: PrismaClient, id: string) {
  z.uuid().parse(id);
  const updated = await prisma.apiClient.updateMany({
    where: { id, status: "enabled", revokedAt: null },
    data: { status: "revoked", revokedAt: new Date() },
  });
  if (updated.count !== 1)
    throw new ApiClientConflict("Key already revoked or unavailable. Reload keys.");
  return prisma.apiClient.findUniqueOrThrow({ where: { id }, select: publicFields });
}
