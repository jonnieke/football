import "dotenv/config";
import {
  getPrisma,
  decideSourceReview,
  reviewDecisionSchema,
} from "@fcp/database";
import { validate as isUuid } from "uuid";

const [command, id, actor, ...reasonParts] = process.argv.slice(2);
if (!["list", "show", "publish-one", "dismiss"].includes(command ?? ""))
  throw new Error(
    "Usage: pnpm source:review list | show <review UUID> | publish-one|dismiss <review UUID> <operator> <reason>",
  );
if (command !== "list" && !isUuid(id ?? ""))
  throw new Error("Supply an explicit review UUID");
const decision =
  command === "publish-one" || command === "dismiss"
    ? reviewDecisionSchema.parse({
        id,
        action: command,
        actor,
        reason: reasonParts.join(" "),
      })
    : undefined;
const prisma = getPrisma();
try {
  if (command === "list") {
    console.table(
      await prisma.sourceEventReview.findMany({
        where: { status: "pending" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          fixtureId: true,
          sourceEventId: true,
          reason: true,
          createdAt: true,
        },
      }),
    );
  } else if (command === "show") {
    console.log(
      JSON.stringify(
        await prisma.sourceEventReview.findUniqueOrThrow({
          where: { id: id! },
        }),
        null,
        2,
      ),
    );
  } else if (decision !== undefined) {
    console.log(await decideSourceReview(prisma, decision));
  }
} finally {
  await prisma.$disconnect();
}
