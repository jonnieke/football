import type { EventDraft } from "@fcp/football-core";
import { generateContent } from "@fcp/content-core";
import type { FixtureChangeJob, ContentGenerationJob } from "@fcp/shared";
import { v7 as uuidv7, validate as isUuid } from "uuid";
import type { PrismaClient } from "./generated/prisma/client.ts";
import { createCanonicalEvent } from "./events.js";
import {
  checkpointEvents,
  completeWork,
  contentWorkSchema,
  ensureContentWork,
  ensureFixtureWork,
  fixtureWorkSchema,
  preparedEventsSchema,
} from "./outbox.js";

async function failWork(
  prisma: PrismaClient,
  id: string,
  error: unknown,
): Promise<never> {
  try {
    await prisma.workOutbox.updateMany({
      where: { id, completedAt: null },
      data: { lastErrorCode: "WORKER_PROCESSING_FAILED" },
    });
  } catch (recordError) {
    throw new AggregateError(
      [error, recordError],
      "Worker and failure recording failed",
    );
  }
  throw error;
}

export async function processFixtureDelivery(
  prisma: PrismaClient,
  job: FixtureChangeJob,
  prepare: (
    payload: Omit<FixtureChangeJob, "outboxId">,
  ) => Promise<EventDraft[]>,
) {
  if (job.outboxId !== undefined && !isUuid(job.outboxId))
    throw new Error("Invalid outbox ID");
  // Existing queue messages from before the migration are adopted durably.
  const work =
    job.outboxId === undefined
      ? await ensureFixtureWork(prisma, fixtureWorkSchema.parse(job))
      : await prisma.workOutbox.findUniqueOrThrow({
          where: { id: job.outboxId },
        });
  if (work.kind !== "fixture_change") throw new Error("Outbox kind mismatch");
  if (work.completedAt !== null || work.pausedAt !== null)
    return { created: 0, duplicates: 0 };
  try {
    const payload = fixtureWorkSchema.parse(work.payload);
    // Freeze drafts before persisting any canonical event. Partial retries no
    // longer refetch a changed upstream response or relink a correction.
    const drafts =
      work.preparedData === null
        ? await checkpointEvents(prisma, work.id, await prepare(payload))
        : preparedEventsSchema.parse(work.preparedData);
    const result = { created: 0, duplicates: 0 };
    for (const draft of drafts) {
      if (draft.fixtureId !== payload.fixtureId)
        throw new Error("Prepared event belongs to another fixture");
      const event = await createCanonicalEvent(prisma, draft);
      if (event.created) result.created += 1;
      else result.duplicates += 1;
    }
    await completeWork(prisma, work.id);
    return result;
  } catch (error) {
    return failWork(prisma, work.id, error);
  }
}

export async function processContentDelivery(
  prisma: PrismaClient,
  job: ContentGenerationJob,
  maxLength: number,
) {
  if (job.outboxId !== undefined && !isUuid(job.outboxId))
    throw new Error("Invalid outbox ID");
  const work =
    job.outboxId === undefined
      ? await ensureContentWork(prisma, contentWorkSchema.parse(job).eventId)
      : await prisma.workOutbox.findUniqueOrThrow({
          where: { id: job.outboxId },
        });
  if (work.kind !== "content_generation")
    throw new Error("Outbox kind mismatch");
  if (work.completedAt !== null || work.pausedAt !== null) return null;
  try {
    const { eventId } = contentWorkSchema.parse(work.payload);
    const event = await prisma.footballEvent.findUniqueOrThrow({
      where: { id: eventId },
      include: {
        team: true,
        fixture: {
          include: { homeTeam: true, awayTeam: true, competition: true },
        },
      },
    });
    const generated = generateContent(
      {
        eventType: event.eventType as Parameters<
          typeof generateContent
        >[0]["eventType"],
        ...(event.minute === null ? {} : { minute: event.minute }),
        homeTeam: event.fixture.homeTeam.name,
        ...(event.fixture.homeTeam.shortName === null
          ? {}
          : { homeTeamShort: event.fixture.homeTeam.shortName }),
        awayTeam: event.fixture.awayTeam.name,
        ...(event.fixture.awayTeam.shortName === null
          ? {}
          : { awayTeamShort: event.fixture.awayTeam.shortName }),
        homeScore: event.homeScore ?? event.fixture.homeScore,
        awayScore: event.awayScore ?? event.fixture.awayScore,
        ...(event.playerName === null ? {} : { playerName: event.playerName }),
        ...(event.team === null ? {} : { scoringTeamName: event.team.name }),
        competitionSlug: event.fixture.competition.slug,
      },
      maxLength,
    );
    return await prisma.$transaction(async (tx) => {
      // Serialize concurrent consumers on the outbox row. This completion is
      // invisible until the content insert commits, and rolls back on failure.
      const claim = await tx.workOutbox.updateMany({
        where: { id: work.id, completedAt: null, pausedAt: null },
        data: { completedAt: new Date(), lastErrorCode: null },
      });
      if (claim.count !== 1) return null;
      const item = await tx.contentItem.upsert({
        where: {
          eventId_channel_contentType: {
            eventId,
            channel: generated.channel,
            contentType: generated.contentType,
          },
        },
        create: {
          id: uuidv7(),
          eventId,
          ...generated,
          status: "published",
          publishedAt: new Date(),
        },
        update: {},
      });
      return item;
    });
  } catch (error) {
    return failWork(prisma, work.id, error);
  }
}
