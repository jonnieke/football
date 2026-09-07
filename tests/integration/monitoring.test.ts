import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectBacklog, evaluateBacklog } from "@fcp/database";
import { createTestResources } from "../support/resources.js";

const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("read-only backlog snapshot in isolated PostgreSQL", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
  }, 90000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30000);
  it("separates active, paused, and completed work without mutating it", async () => {
    const { prisma } = resources;
    const old = new Date(Date.now() - 600000);
    await prisma.workOutbox.createMany({
      data: [
        {
          id: randomUUID(),
          kind: "content_generation",
          dedupeKey: "active",
          payload: { secret: "not-for-monitor-output" },
          createdAt: old,
          availableAt: new Date(Date.now() + 60000),
        },
        {
          id: randomUUID(),
          kind: "fixture_change",
          dedupeKey: "paused",
          payload: {},
          createdAt: old,
          pausedAt: old,
        },
        {
          id: randomUUID(),
          kind: "fixture_change",
          dedupeKey: "done",
          payload: {},
          createdAt: old,
          completedAt: old,
        },
      ],
    });
    await prisma.pollingRun.create({
      data: {
        id: randomUUID(),
        provider: "api-football",
        status: "succeeded",
        finishedAt: old,
      },
    });
    const before = await prisma.workOutbox.findMany({
      orderBy: { dedupeKey: "asc" },
    });
    const snapshot = await collectBacklog(prisma);
    expect(snapshot.pending.count).toBe(1);
    expect(snapshot.paused).toBe(1);
    expect(snapshot.pending.oldest).toEqual(old);
    expect(snapshot.reviews.count).toBe(0);
    expect(snapshot.lastProviderSuccess).toEqual(old);
    expect(snapshot.providerExpected).toBe(false);
    await prisma.competition.create({
      data: {
        id: randomUUID(),
        source: "api-football",
        sourceId: "39",
        name: "Test",
        slug: "test",
        season: 2026,
      },
    });
    expect(evaluateBacklog(await collectBacklog(prisma)).alerts).toContainEqual(
      {
        code: "PROVIDER_POLL_STALE",
        severity: "critical",
      },
    );
    expect(evaluateBacklog(snapshot).status).toBe("critical");
    expect(JSON.stringify(snapshot)).not.toContain("not-for-monitor-output");
    expect(
      await prisma.workOutbox.findMany({ orderBy: { dedupeKey: "asc" } }),
    ).toEqual(before);
  });
});
