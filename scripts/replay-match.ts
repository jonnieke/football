import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { sandboxEnvironment } from "./sandbox-config.js";
import { decodeCapture } from "./replay-capture.js";
import { replayPreview, type ReplayReport } from "./replay-preview.js";

const name = process.argv[2] ?? "";
if (!/^\d+-[a-f0-9-]{36}\.json$/.test(name))
  throw new Error("Supply a capture filename, not a path");
if (process.versions.node.split(".")[0] !== "24")
  throw new Error("Node 24 required");
const env = sandboxEnvironment(process.env);
if (process.argv[3] !== "--isolated-child") {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
      name,
      "--isolated-child",
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env,
      stdio: "inherit",
      windowsHide: true,
      timeout: 180_000,
    },
  );
  process.exitCode = child.status ?? 1;
} else {
  // Validate inherited endpoints before dynamic imports/client creation. The
  // parent process only launches this child with an allowlisted environment.
  const { testEndpoints } = await import("../tests/support/isolation.js");
  const actual = testEndpoints(process.env);
  assert.equal(actual.databaseUrl, env.TEST_DATABASE_URL);
  assert.equal(actual.redisUrl, env.TEST_REDIS_URL);
  const capturePath = new URL(
    `../.sandbox-replay/captures/${name}`,
    import.meta.url,
  );
  if ((await stat(capturePath)).size > 4_100_000)
    throw new Error("Capture file too large");
  const raw = await readFile(capturePath, "utf8");
  const { fixture, events } = await decodeCapture(JSON.parse(raw));
  const { createTestResources } = await import("../tests/support/resources.js");
  const {
    persistNormalizedFixture,
    processFixtureDelivery,
    prepareFixtureObservation,
    processContentDelivery,
  } = await import("../packages/database/src/index.js");
  const resources = await createTestResources(env);
  let report: ReplayReport;
  try {
    const { prisma } = resources;
    await persistNormalizedFixture(prisma, fixture, events);
    const work = await prisma.workOutbox.findMany({
      where: { kind: "fixture_change" },
      orderBy: { id: "asc" },
    });
    const deliver = async () => {
      for (const row of work)
        await processFixtureDelivery(
          prisma,
          {
            outboxId: row.id,
            ...(row.payload as {
              fixtureId: string;
              previousStateId: string;
              currentStateId: string;
            }),
          },
          (payload) => prepareFixtureObservation(prisma, payload),
        );
      for (const event of await prisma.footballEvent.findMany())
        await processContentDelivery(prisma, { eventId: event.id }, 160);
    };
    await deliver();
    const before = {
      events: await prisma.footballEvent.count(),
      content: await prisma.contentItem.count(),
      work: await prisma.workOutbox.count(),
      states: await prisma.fixtureState.count(),
    };
    // A later observation containing the same final facts must not enqueue work.
    await persistNormalizedFixture(
      prisma,
      { ...fixture, receivedAt: new Date(fixture.receivedAt.getTime() + 1000) },
      events,
    );
    await deliver();
    assert.deepEqual(
      {
        events: await prisma.footballEvent.count(),
        content: await prisma.contentItem.count(),
        work: await prisma.workOutbox.count(),
        states: await prisma.fixtureState.count(),
      },
      before,
    );
    const items = await prisma.contentItem.findMany({
      include: { event: true },
    });
    items.sort(
      (a, b) =>
        (a.event.minute ?? 999) - (b.event.minute ?? 999) ||
        (a.event.extraTime ?? 0) - (b.event.extraTime ?? 0) ||
        a.event.eventType.localeCompare(b.event.eventType),
    );
    report = {
      match: `${fixture.homeTeam.name} ${fixture.score.home}–${fixture.score.away} ${fixture.awayTeam.name}`,
      kickoff: fixture.kickoffAt.toISOString(),
      capturedAt: fixture.receivedAt.toISOString(),
      fixtureId: fixture.sourceFixtureId,
      captureSha256: createHash("sha256").update(raw).digest("hex"),
      sourceEvents: events.length,
      canonicalEvents: before.events,
      reviews: await prisma.sourceEventReview.count({
        where: { status: "pending" },
      }),
      pending: await prisma.workOutbox.count({ where: { completedAt: null } }),
      duplicateCheckPassed: true,
      content: items.map((item) => ({
        eventType: item.event.eventType,
        minute: item.event.minute,
        extraTime: item.event.extraTime,
        shortText: item.shortText,
        standardText: item.standardText,
      })),
    };
  } finally {
    await resources.cleanup();
  }
  // Export only after cleanup succeeds. Never publish or upload this artifact.
  const directory = new URL(
    `../.sandbox-replay/results/${randomUUID()}/`,
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL("report.json", directory),
    JSON.stringify(report, null, 2),
    { flag: "wx" },
  );
  await writeFile(new URL("preview.html", directory), replayPreview(report), {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      preview: fileURLToPath(new URL("preview.html", directory)),
      match: report.match,
      content: report.content.length,
      reviews: report.reviews,
      duplicateCheckPassed: report.duplicateCheckPassed,
      testSchemaCleaned: true,
    }),
  );
}
