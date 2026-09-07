import "dotenv/config";
import { getPrisma } from "@fcp/database";
import { v7 as uuidv7 } from "uuid";

const [actor, ...reasonParts] = process.argv.slice(2);
const decision = {
  actor: actor?.trim() ?? "",
  reason: reasonParts.join(" ").trim(),
};
if (
  !decision.actor ||
  decision.actor.length > 200 ||
  !decision.reason ||
  decision.reason.length > 2000
)
  throw new Error(
    "Usage: pnpm feed:reset-cursors <operator> <reason> (operator <= 200 characters; reason <= 2000)",
  );
const prisma = getPrisma();
try {
  const epoch = uuidv7();
  await prisma.$transaction(async (tx) => {
    await tx.feedPublicationState.update({ where: { id: 1 }, data: { epoch } });
    await tx.systemIncident.create({
      data: {
        id: uuidv7(),
        component: "feed",
        severity: "info",
        code: "CURSOR_EPOCH_ROTATED",
        message: "Operator invalidated feed cursors",
        status: "resolved",
        resolvedAt: new Date(),
        metadata: { epoch, ...decision },
      },
    });
  });
  console.log({
    epoch,
    message:
      "Existing cursors now require reset; published content is unchanged.",
  });
} finally {
  await prisma.$disconnect();
}
