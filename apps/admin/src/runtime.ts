import {
  createPrisma,
  changeAlertRecipient,
  listAlertRecipients,
  listDraftContent,
  approveContent,
  listCompetitions,
  changeCompetition,
  competitionHistory,
  listApiClients,
  createApiClient,
  revokeApiClient,
  listMatchControls,
  changeMatchControl,
  listPreMatchApprovals,
  togglePreMatchApproval,
} from "@fcp/database";
import { createAdminRedis } from "./redis.js";
import { adminConfig } from "./config.js";
import { buildAdmin } from "./app.js";
import { dashboardReader } from "./dashboard.js";
import { liveFeedReader } from "./live-feed.js";
import { fileURLToPath } from "node:url";

/** Shared initialization for local listening and serverless invocation. */
export async function initializeAdmin() {
  const config = adminConfig(process.env);
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
    throw new Error("Administrator database and Redis configuration required");
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (process.env.DATABASE_CA) {
    if (process.env.DATABASE_CA !== "supabase-2021")
      throw new Error("Unsupported database CA");
    for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"])
      databaseUrl.searchParams.delete(key);
    databaseUrl.searchParams.set("sslmode", "verify-full");
    databaseUrl.searchParams.set(
      "sslrootcert",
      fileURLToPath(new URL("../certs/supabase-ca-2021.crt", import.meta.url)),
    );
  }
  const prisma = createPrisma(databaseUrl.toString(), {
    connectionTimeoutMillis: 5000,
  });
  const connections = createAdminRedis(process.env.REDIS_URL);
  const redis = connections.redis;
  try {
    const app = buildAdmin({
      config,
      redis,
      acquireRedis: () => connections.acquire(),
      dashboard: dashboardReader(prisma, redis, config.QUEUE_PREFIX),
      liveFeed: liveFeedReader(prisma),
      matches: {
        list: (date) => listMatchControls(prisma, date),
        change: (input, actor) => changeMatchControl(prisma, input, actor),
      },
      preMatch: {
        list: (date) => listPreMatchApprovals(prisma, date),
        toggle: (input, actor) => togglePreMatchApproval(prisma, input, actor),
      },
      competitions: {
        list: (after) => listCompetitions(prisma, after),
        change: (input, actor) => changeCompetition(prisma, input, actor),
        history: () => competitionHistory(prisma),
      },
      apiClients: {
        list: () => listApiClients(prisma),
        create: (input) => createApiClient(prisma, input),
        revoke: (id) => revokeApiClient(prisma, id),
      },
      content: {
        list: (after) => listDraftContent(prisma, after),
        approve: (input, actor) => approveContent(prisma, input, actor),
        history: () =>
          prisma.contentApproval.findMany({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 20,
            select: {
              contentId: true,
              actor: true,
              createdAt: true,
              snapshot: true,
            },
          }),
      },
      matchEmails: () =>
        prisma.matchEmailDelivery.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 50,
          select: {
            id: true,
            email: true,
            subject: true,
            status: true,
            attempts: true,
            createdAt: true,
            lastErrorCode: true,
          },
        }),
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
      connections.close();
      await prisma.$disconnect();
    });
    await app.ready();
    return app;
  } catch (error) {
    connections.close();
    await prisma.$disconnect();
    throw error;
  }
}
