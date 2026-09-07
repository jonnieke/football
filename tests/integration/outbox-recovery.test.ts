import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  dispatchOutbox,
  persistNormalizedFixture,
  processContentDelivery,
  processFixtureDelivery,
  retryWork,
} from "@fcp/database";
import type { NormalizedFixture } from "@fcp/football-core";
import { createTestResources } from "../support/resources.js";
import { schemaIdentifier } from "../support/isolation.js";

const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite(
  "PostgreSQL outbox rollback and consumer recovery (queue transport simulated)",
  () => {
    let resources: Awaited<ReturnType<typeof createTestResources>> | undefined;
    beforeAll(async () => {
      resources = await createTestResources(process.env);
    }, 90_000);
    afterAll(async () => {
      await resources?.cleanup();
    }, 30_000);

    it("survives queue loss and rolls back each handoff atomically", async () => {
      const { prisma, namespace } = resources!;
      const schema = schemaIdentifier(namespace);
      const fixture: NormalizedFixture = {
        id: "upstream-fixture",
        source: "synthetic",
        sourceFixtureId: "9002",
        competition: {
          id: "league",
          source: "synthetic",
          sourceId: "39",
          name: "Test League",
          slug: "test-league",
          season: 2026,
        },
        homeTeam: {
          id: "home",
          source: "synthetic",
          sourceId: "1",
          name: "Home",
        },
        awayTeam: {
          id: "away",
          source: "synthetic",
          sourceId: "2",
          name: "Away",
        },
        score: { home: 0, away: 0 },
        status: "first_half",
        minute: 1,
        kickoffAt: new Date("2026-09-07T12:00:00Z"),
        receivedAt: new Date("2026-09-07T12:01:00Z"),
      };
      await persistNormalizedFixture(prisma, fixture);
      // Force an outbox failure after snapshot insertion; the whole observation must roll back.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${schema}.work_outbox ADD CONSTRAINT test_reject_fixture CHECK (kind <> 'fixture_change') NOT VALID`,
      );
      const update = {
        ...fixture,
        score: { home: 1, away: 0 },
        minute: 12,
        receivedAt: new Date("2026-09-07T12:12:00Z"),
      };
      await expect(persistNormalizedFixture(prisma, update)).rejects.toThrow();
      expect(await prisma.fixtureState.count()).toBe(1);
      expect((await prisma.fixture.findFirstOrThrow()).homeScore).toBe(0);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${schema}.work_outbox DROP CONSTRAINT test_reject_fixture`,
      );
      const changed = await persistNormalizedFixture(prisma, update);
      const work = await prisma.workOutbox.findFirstOrThrow({
        where: { kind: "fixture_change" },
      });
      expect(
        (
          await dispatchOutbox(prisma, () =>
            Promise.reject(new Error("Redis unavailable")),
          )
        ).failed,
      ).toBe(1);
      await retryWork(prisma, work.id);
      const deliver = vi.fn().mockResolvedValue(undefined);
      await dispatchOutbox(prisma, deliver);
      await dispatchOutbox(prisma, deliver, new Date(Date.now() + 61_000));
      expect(deliver).toHaveBeenCalledTimes(2); // Simulates disappearance after successful enqueue.
      expect(
        (await prisma.workOutbox.findUniqueOrThrow({ where: { id: work.id } }))
          .completedAt,
      ).toBeNull();
      const job = {
        outboxId: work.id,
        fixtureId: changed.fixtureId,
        previousStateId: changed.previousStateId!,
        currentStateId: changed.currentStateId,
      };
      const prepare = vi.fn().mockResolvedValue([
        {
          fixtureId: changed.fixtureId,
          eventType: "goal",
          sourceEventId: "goal-12",
          minute: 12,
          homeScore: 1,
          awayScore: 0,
        },
      ]);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${schema}.work_outbox ADD CONSTRAINT test_reject_content CHECK (kind <> 'content_generation') NOT VALID`,
      );
      await expect(
        processFixtureDelivery(prisma, job, prepare),
      ).rejects.toThrow();
      expect(await prisma.footballEvent.count()).toBe(0);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${schema}.work_outbox DROP CONSTRAINT test_reject_content`,
      );
      await processFixtureDelivery(prisma, job, prepare);
      await processFixtureDelivery(prisma, job, prepare); // Lost acknowledgement.
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(await prisma.footballEvent.count()).toBe(1);
      const contentWork = await prisma.workOutbox.findFirstOrThrow({
        where: { kind: "content_generation" },
      });
      const event = await prisma.footballEvent.findFirstOrThrow();
      const contentJob = { outboxId: contentWork.id, eventId: event.id };
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${schema}.content_items ADD CONSTRAINT test_reject_content_insert CHECK (false) NOT VALID`,
      );
      await expect(
        processContentDelivery(prisma, contentJob, 160),
      ).rejects.toThrow();
      expect(
        (
          await prisma.workOutbox.findUniqueOrThrow({
            where: { id: contentWork.id },
          })
        ).completedAt,
      ).toBeNull();
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${schema}.content_items DROP CONSTRAINT test_reject_content_insert`,
      );
      await Promise.all([
        processContentDelivery(prisma, contentJob, 160),
        processContentDelivery(prisma, contentJob, 160),
      ]);
      expect(await prisma.contentItem.count()).toBe(1);
      expect(
        await prisma.workOutbox.count({ where: { completedAt: null } }),
      ).toBe(0);
    }, 60_000);
  },
);
