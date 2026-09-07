import "dotenv/config";
import { open } from "node:fs/promises";
import {
  createPrisma,
  changeAlertRecipient,
  listAlertRecipients,
} from "@fcp/database";
import { validate as isUuid } from "uuid";

let prisma: ReturnType<typeof createPrisma> | undefined;
try {
  const [command, argument, extra] = process.argv.slice(2);
  if (
    extra !== undefined ||
    !["list", "apply", "history"].includes(command ?? "") ||
    (command === "apply" && !argument) ||
    (command === "history" && !isUuid(argument ?? ""))
  )
    throw new Error("Invalid command");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Database configuration required");
  prisma = createPrisma(url, { connectionTimeoutMillis: 5000 });
  if (command === "list")
    console.log(
      JSON.stringify(await listAlertRecipients(prisma, argument), null, 2),
    );
  else if (command === "history")
    console.log(
      JSON.stringify(
        await prisma.alertRecipientAudit.findMany({
          where: { recipientId: argument! },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
        }),
        null,
        2,
      ),
    );
  else {
    const file = await open(argument!, "r");
    let input: unknown;
    try {
      if ((await file.stat()).size > 16384)
        throw new Error("Change file too large");
      input = JSON.parse(await file.readFile("utf8")) as unknown;
    } finally {
      await file.close();
    }
    console.log(
      JSON.stringify(await changeAlertRecipient(prisma, input), null, 2),
    );
  }
} catch {
  // Avoid leaking DB connection details or addresses through exception messages.
  console.error(
    "Recipient operation failed. Check command, JSON, duplicate address and current version. Usage: alert:recipients list [after-UUID] | history <UUID> | apply <change.json>",
  );
  process.exitCode = 1;
} finally {
  try {
    await prisma?.$disconnect();
  } catch {
    console.error("Recipient connection cleanup failed.");
    process.exitCode = 1;
  }
}
