import "dotenv/config";
import {
  getPrisma,
  ensureContentWork,
  ensureFixtureWork,
  retryWork,
} from "@fcp/database";
import { validate as isUuid } from "uuid";

const [command, id, previousId] = process.argv.slice(2);
if (
  !["status", "pause", "retry", "reconcile", "fixture"].includes(command ?? "")
) {
  throw new Error(
    "Usage: pnpm outbox:recover status | pause <outbox UUID> | retry <outbox UUID> | reconcile | fixture <current-state UUID> <previous-state UUID>",
  );
}
if (
  command !== "reconcile" &&
  command !== "status" &&
  (!isUuid(id ?? "") || (command === "fixture" && !isUuid(previousId ?? "")))
) {
  throw new Error("Recovery targets must be explicit UUIDs");
}
const prisma = getPrisma();
try {
  if (command === "status") {
    const records = await prisma.workOutbox.findMany({
      where: { completedAt: null },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        kind: true,
        attempts: true,
        availableAt: true,
        pausedAt: true,
        lastErrorCode: true,
        createdAt: true,
      },
    });
    console.table(records);
  } else if (command === "pause") {
    const result = await prisma.workOutbox.updateMany({
      where: { id: id!, completedAt: null },
      data: { pausedAt: new Date(), lastErrorCode: "OPERATOR_PAUSED" },
    });
    console.log({ pendingRecordsPaused: result.count });
  } else if (command === "retry") {
    const result = await retryWork(prisma, id!);
    console.log({ pendingRecordsRescheduled: result.count });
  } else if (command === "fixture") {
    const [current, previous] = await Promise.all([
      prisma.fixtureState.findUniqueOrThrow({ where: { id: id! } }),
      prisma.fixtureState.findUniqueOrThrow({ where: { id: previousId! } }),
    ]);
    if (
      current.id === previous.id ||
      current.fixtureId !== previous.fixtureId ||
      current.capturedAt < previous.capturedAt
    ) {
      throw new Error(
        "Snapshots must be distinct, ordered, and belong to the same fixture",
      );
    }
    const work = await ensureFixtureWork(prisma, {
      fixtureId: current.fixtureId,
      previousStateId: previous.id,
      currentStateId: current.id,
    });
    await retryWork(prisma, work.id);
    console.log({ outboxId: work.id, completed: work.completedAt !== null });
  } else {
    let after: string | undefined;
    let repaired = 0;
    for (;;) {
      const events = await prisma.footballEvent.findMany({
        where: {
          contentItems: { none: {} },
          ...(after === undefined ? {} : { id: { gt: after } }),
        },
        orderBy: { id: "asc" },
        take: 100,
        select: { id: true },
      });
      if (events.length === 0) break;
      for (const event of events) {
        await prisma.$transaction(async (tx) => {
          const work = await ensureContentWork(tx, event.id);
          // A completed marker with missing content needs operator-requested repair too.
          await tx.workOutbox.update({
            where: { id: work.id },
            data: {
              completedAt: null,
              pausedAt: null,
              availableAt: new Date(),
              lastErrorCode: null,
            },
          });
        });
        repaired += 1;
      }
      after = events.at(-1)!.id;
    }
    console.log({ missingContentEventsRescheduled: repaired });
  }
} finally {
  await prisma.$disconnect();
}
