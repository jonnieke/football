import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  changeCompetition,
  listCompetitions,
  competitionHistory,
} from "@fcp/database";
import { createTestResources } from "../support/resources.js";
import { schemaIdentifier } from "../support/isolation.js";
const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("audited league coverage", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
  }, 90000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30000);
  const input = {
    action: "add",
    sourceId: "39",
    season: 2026,
    name: "Premier League",
  };
  it("adds paused seasons, enables, rejects concurrent/stale edits and retains the previous season", async () => {
    const { prisma } = resources;
    const added = await changeCompetition(prisma, input, "admin@example.com");
    expect(added).toMatchObject({ enabled: false, coverageVersion: 1 });
    await expect(
      changeCompetition(prisma, input, "admin@example.com"),
    ).rejects.toThrow("already exist");
    const enabled = await changeCompetition(
      prisma,
      {
        action: "set-enabled",
        id: added.id,
        version: 1,
        enabled: true,
      },
      "admin@example.com",
    );
    expect(enabled.enabled).toBe(true);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        changeCompetition(
          prisma,
          {
            action: "set-enabled",
            id: added.id,
            version: 2,
            enabled: false,
          },
          "admin@example.com",
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await prisma.competitionAudit.count()).toBe(3);
    const next = await changeCompetition(
      prisma,
      { ...input, season: 2027 },
      "admin@example.com",
    );
    expect(next.enabled).toBe(false);
    const list = await listCompetitions(prisma);
    expect(list).toHaveLength(2);
    expect(list.find((item) => item.id === added.id)).toMatchObject({
      season: 2026,
      enabled: false,
      coverageVersion: 3,
    });
    const page = await listCompetitions(prisma, list[0]!.id);
    expect(page).toHaveLength(1);
    expect(page[0]!.id).toBe(list[1]!.id);
    const pause = (await competitionHistory(prisma)).find(
      (entry) => entry.action === "pause",
    );
    expect(pause?.actor).toBe("admin@example.com");
    expect(pause?.before).toMatchObject({ enabled: true });
    expect(pause?.after).toMatchObject({ enabled: false });
  });
  it("rolls back settings if the audit cannot be saved and protects the audit table", async () => {
    const { prisma, namespace } = resources;
    const schema = schemaIdentifier(namespace);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${schema}.competition_audit ADD CONSTRAINT reject_test_actor CHECK (actor <> 'reject-test')`,
    );
    const item = (await listCompetitions(prisma))[0]!;
    await expect(
      changeCompetition(
        prisma,
        {
          action: "set-enabled",
          id: item.id,
          version: item.coverageVersion,
          enabled: true,
        },
        "reject-test",
      ),
    ).rejects.toThrow();
    expect(
      await prisma.competition.findUnique({ where: { id: item.id } }),
    ).toMatchObject({
      enabled: item.enabled,
      coverageVersion: item.coverageVersion,
    });
    await expect(
      changeCompetition(prisma, { ...input, season: 2028 }, "reject-test"),
    ).rejects.toThrow();
    expect(await prisma.competition.count()).toBe(2);
    const security = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`
      SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=${namespace} AND c.relname='competition_audit'`;
    expect(security[0]?.relrowsecurity).toBe(true);
  });
});
