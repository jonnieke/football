import { setTimeout as sleep } from "node:timers/promises";
import {
  createPrisma,
  deliverNextMatchEmail,
  matchEmailConfig,
  resendMatchSender,
} from "@fcp/database";

// No implicit dotenv loading, no inclusion in `pnpm dev`, and no default sending.
if (process.argv.slice(2).join(" ") !== "--run") {
  console.log(
    "Sender not started. Requires --run and explicit MATCH_EMAIL_ENABLED=true configuration.",
  );
} else {
  let prisma: ReturnType<typeof createPrisma> | undefined;
  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
  });
  process.once("SIGTERM", () => {
    stopping = true;
  });
  try {
    const config = matchEmailConfig(process.env);
    prisma = createPrisma(config.DATABASE_URL, {
      connectionTimeoutMillis: 5000,
    });
    const send = resendMatchSender(config);
    while (!stopping) {
      try {
        const status = await deliverNextMatchEmail(prisma, send);
        if (status !== "idle")
          console.log(JSON.stringify({ component: "match-email", status }));
      } catch {
        console.error(
          JSON.stringify({
            component: "match-email",
            code: "PROCESSING_FAILED",
          }),
        );
      }
      await sleep(1000);
    }
  } catch {
    console.error(
      "Match email worker configuration or startup failed; sending remains stopped.",
    );
    process.exitCode = 1;
  } finally {
    try {
      await prisma?.$disconnect();
    } catch {
      console.error("Match email worker cleanup failed.");
      process.exitCode = 1;
    }
  }
}
