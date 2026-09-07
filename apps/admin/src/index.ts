import {
  createPrisma,
  changeAlertRecipient,
  listAlertRecipients,
} from "@fcp/database";
import { createProducerRedis } from "@fcp/shared";
import { adminConfig } from "./config.js";
import { buildAdmin } from "./app.js";
const config = adminConfig(process.env);
if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
  throw new Error("Administrator database and Redis configuration required");
const prisma = createPrisma(process.env.DATABASE_URL, {
  connectionTimeoutMillis: 5000,
});
const redis = createProducerRedis(process.env.REDIS_URL);
redis.on("error", () =>
  console.error(
    JSON.stringify({ component: "admin", code: "ADMIN_REDIS_UNAVAILABLE" }),
  ),
);
await redis.connect();
const app = buildAdmin({
  config,
  redis,
  store: {
    list: (after) => listAlertRecipients(prisma, after),
    change: (input) => changeAlertRecipient(prisma, input),
    history: (id) =>
      prisma.alertRecipientAudit.findMany({
        where: { recipientId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
  },
});
app.addHook("onClose", async () => {
  redis.disconnect();
  await prisma.$disconnect();
});
await app.listen({
  host: process.env.ADMIN_HOST ?? "127.0.0.1",
  port: Number(process.env.ADMIN_PORT ?? 3001),
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close();
  });
