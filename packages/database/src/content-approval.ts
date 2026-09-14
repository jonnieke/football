import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import type { ContentItem, PrismaClient } from "./generated/prisma/client.ts";

export class ContentApprovalConflict extends Error {}
export const contentApprovalSchema = z
  .object({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

function snapshot(item: ContentItem) {
  return {
    id: item.id,
    eventId: item.eventId,
    channel: item.channel,
    contentType: item.contentType,
    priority: item.priority,
    shortText: item.shortText,
    standardText: item.standardText,
    status: item.status,
  };
}
export function contentFingerprint(item: ContentItem) {
  return createHash("sha256")
    .update(JSON.stringify(snapshot(item)))
    .digest("hex");
}
export async function listDraftContent(prisma: PrismaClient, after?: string) {
  if (after !== undefined) z.uuid().parse(after);
  const items = await prisma.contentItem.findMany({
    where: { status: "draft", ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" },
    take: 50,
    include: {
      event: {
        include: { fixture: { include: { homeTeam: true, awayTeam: true } } },
      },
    },
  });
  return items.map((item) => ({
    ...snapshot(item),
    fingerprint: contentFingerprint(item),
    createdAt: item.createdAt,
    eventType: item.event.eventType,
    minute: item.event.minute,
    kickoffAt: item.event.fixture.kickoffAt,
    match: `${item.event.fixture.homeTeam.name} v ${item.event.fixture.awayTeam.name}`,
  }));
}

/** Caller must derive actor from a valid approved-admin session, never the body. */
export async function approveContent(
  prisma: PrismaClient,
  input: unknown,
  actor: string,
) {
  const { id, fingerprint } = contentApprovalSchema.parse(input);
  actor = z.string().trim().toLowerCase().max(254).pipe(z.email()).parse(actor);
  return prisma.$transaction(
    async (tx) => {
      // Lock the exact reviewed row; publication and audit commit together.
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      const claim = await tx.contentItem.updateMany({
        where: { id, status: "draft" },
        data: { status: "draft" },
      });
      if (claim.count !== 1)
        throw new ContentApprovalConflict(
          "Content changed or was already published; reload drafts",
        );
      const item = await tx.contentItem.findUnique({ where: { id } });
      if (
        !item ||
        item.status !== "draft" ||
        contentFingerprint(item) !== fingerprint
      )
        throw new ContentApprovalConflict(
          "Content changed or was already published; reload drafts",
        );
      const approval = await tx.contentApproval.create({
        data: {
          id: uuidv7(),
          contentId: id,
          actor,
          fingerprint,
          snapshot: snapshot(item),
        },
      });
      // The existing DB trigger assigns a commit-ordered sequence and event type.
      const published = await tx.contentItem.update({
        where: { id },
        data: { status: "published", publishedAt: new Date() },
      });
      return {
        id: published.id,
        status: published.status,
        publishedAt: published.publishedAt,
        actor: approval.actor,
      };
    },
    { timeout: 10_000 },
  );
}
