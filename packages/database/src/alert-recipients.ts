import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "./generated/prisma/client.ts";

export const recipientSettingsSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    enabled: z.boolean(),
    warnings: z.boolean(),
    critical: z.boolean(),
    recovery: z.boolean(),
  })
  .strict();
const actor = z.string().trim().min(1).max(200);
const target = {
  id: z.uuid(),
  version: z.number().int().min(1).max(2147483646),
  actor,
};
export const recipientChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add"),
      actor,
      settings: recipientSettingsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      ...target,
      settings: recipientSettingsSchema,
    })
    .strict(),
  z.object({ action: z.literal("remove"), ...target }).strict(),
]);
const select = {
  id: true,
  email: true,
  enabled: true,
  warnings: true,
  critical: true,
  recovery: true,
  version: true,
} as const;

/** Trusted operator only. A future HTTP handler must derive actor from its authenticated session. */
export async function changeAlertRecipient(
  prisma: PrismaClient,
  input: unknown,
) {
  const change = recipientChangeSchema.parse(input);
  return prisma.$transaction(
    async (tx) => {
      if (change.action === "add") {
        const after = await tx.alertRecipient.create({
          data: { id: randomUUID(), ...change.settings },
          select,
        });
        await tx.alertRecipientAudit.create({
          data: {
            id: randomUUID(),
            recipientId: after.id,
            actor: change.actor,
            action: change.action,
            before: Prisma.DbNull,
            after,
          },
        });
        return after;
      }
      const before = await tx.alertRecipient.findUniqueOrThrow({
        where: { id: change.id },
        select,
      });
      if (before.version !== change.version)
        throw new Error("Recipient changed; reload before editing");
      const where = { id: change.id, version: change.version };
      const result =
        change.action === "remove"
          ? await tx.alertRecipient.deleteMany({ where })
          : await tx.alertRecipient.updateMany({
              where,
              data: { ...change.settings, version: { increment: 1 } },
            });
      if (result.count !== 1)
        throw new Error("Recipient changed; reload before editing");
      const after =
        change.action === "remove"
          ? null
          : await tx.alertRecipient.findUniqueOrThrow({
              where: { id: change.id },
              select,
            });
      await tx.alertRecipientAudit.create({
        data: {
          id: randomUUID(),
          recipientId: change.id,
          actor: change.actor,
          action: change.action,
          before,
          after: after ?? Prisma.DbNull,
        },
      });
      return after;
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

export function listAlertRecipients(prisma: PrismaClient, after?: string) {
  if (after !== undefined) z.uuid().parse(after);
  return prisma.alertRecipient.findMany({
    where: after === undefined ? {} : { id: { gt: after } },
    orderBy: { id: "asc" },
    take: 100,
    select,
  });
}
