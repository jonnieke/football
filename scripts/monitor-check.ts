import "dotenv/config";
import {
  createPrisma,
  collectBacklog,
  evaluateBacklog,
  monitorThresholds,
} from "@fcp/database";

// Fixed deadline also covers connection startup/cleanup, not just SQL execution.
const deadline = setTimeout(() => {
  console.error(
    JSON.stringify({ version: 1, status: "unknown", code: "MONITOR_TIMEOUT" }),
  );
  process.exit(3);
}, 20000);
let prisma: ReturnType<typeof createPrisma> | undefined;
try {
  const options: Record<string, number> = {};
  for (const arg of process.argv.slice(2)) {
    const match =
      /^--(outboxSeconds|reviewSeconds|providerSeconds)=(\d+)$/.exec(arg);
    if (!match || options[match[1]!] !== undefined)
      throw new Error("Invalid monitor arguments");
    options[match[1]!] = Number(match[2]);
  }
  const thresholds = monitorThresholds.parse(options);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing database configuration");
  prisma = createPrisma(url, { connectionTimeoutMillis: 5000 });
  const report = evaluateBacklog(await collectBacklog(prisma), thresholds);
  console.log(JSON.stringify(report));
  process.exitCode =
    report.status === "critical" ? 2 : report.status === "warning" ? 1 : 0;
} catch {
  // Do not print driver errors: they can contain connection details or SQL.
  console.error(
    JSON.stringify({
      version: 1,
      status: "unknown",
      code: "MONITOR_CHECK_FAILED",
    }),
  );
  process.exitCode = 3;
} finally {
  try {
    await prisma?.$disconnect();
  } catch {
    console.error(
      JSON.stringify({
        version: 1,
        status: "unknown",
        code: "MONITOR_CLEANUP_FAILED",
      }),
    );
    process.exitCode = 3;
  }
  clearTimeout(deadline);
}
