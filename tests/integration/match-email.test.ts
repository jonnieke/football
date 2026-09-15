import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  changeAlertRecipient,
  createCanonicalEvent,
  deliverNextMatchEmail,
  enqueueMatchEmails,
  MatchEmailSendError,
  persistNormalizedFixture,
  processContentDelivery,
} from "@fcp/database";
import { createTestResources } from "../support/resources.js";
const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("durable match emails (fake sender only)", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  let fixtureId: string;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
    const fixture = await persistNormalizedFixture(resources.prisma, {
      id: "f",
      source: "api-football",
      sourceFixtureId: "email-test",
      competition: {
        id: "c",
        source: "api-football",
        sourceId: "39",
        season: 2026,
        name: "Test league",
        slug: "email-test",
      },
      homeTeam: {
        id: "h",
        source: "api-football",
        sourceId: "email-home",
        name: "Home",
      },
      awayTeam: {
        id: "a",
        source: "api-football",
        sourceId: "email-away",
        name: "Away",
      },
      status: "first_half",
      score: { home: 0, away: 0 },
      kickoffAt: new Date(),
      receivedAt: new Date(),
    });
    fixtureId = fixture.fixtureId;
    await resources.prisma.competition.updateMany({ data: { enabled: true } });
  }, 90000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30000);
  const settings = {
    email: "match@example.com",
    enabled: true,
    matchAlerts: true,
    warnings: false,
    critical: false,
    recovery: false,
  };
  async function recipient(email: string) {
    return (await changeAlertRecipient(resources.prisma, {
      action: "add",
      actor: "test-admin",
      settings: { ...settings, email },
    }))!;
  }
  it("defaults existing-style recipients off and queues once for fresh automatic publication", async () => {
    const { prisma } = resources;
    const subscribed = await recipient(settings.email);
    const old = await changeAlertRecipient(prisma, {
      action: "add",
      actor: "test-admin",
      settings: {
        email: "health@example.com",
        enabled: true,
        warnings: true,
        critical: true,
        recovery: true,
      },
    });
    expect(old?.matchAlerts).toBe(false);
    const historical = await createCanonicalEvent(prisma, {
      fixtureId,
      eventType: "goal",
      minute: 1,
    });
    await processContentDelivery(prisma, { eventId: historical.id }, 160);
    expect(await prisma.matchEmailDelivery.count()).toBe(0);
    const live = await createCanonicalEvent(prisma, {
      fixtureId,
      eventType: "goal",
      minute: 2,
      liveObservedAt: new Date(),
    });
    await Promise.all([
      processContentDelivery(prisma, { eventId: live.id }, 160),
      processContentDelivery(prisma, { eventId: live.id }, 160),
    ]);
    const jobs = await prisma.matchEmailDelivery.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      eventId: live.id,
      recipientId: subscribed.id,
      status: "pending",
    });
    const send = vi.fn().mockResolvedValue("provider-accepted");
    const outcomes = await Promise.all([
      deliverNextMatchEmail(prisma, send),
      deliverNextMatchEmail(prisma, send),
    ]);
    expect(outcomes).toContain("accepted");
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await prisma.matchEmailDelivery.findUnique({
        where: { id: jobs[0]!.id },
      }),
    ).toMatchObject({ status: "accepted", providerId: "provider-accepted" });
    await prisma.alertRecipient.updateMany({ data: { matchAlerts: false } });
  });
  async function queue(email: string, now: Date) {
    const target = await recipient(email);
    const eventId = randomUUID();
    await resources.prisma.$transaction((tx) =>
      enqueueMatchEmails(tx, {
        eventId,
        subject: "Goal\r\nTest",
        text: "Home 1-0 Away",
        now,
      }),
    );
    await resources.prisma.alertRecipient.updateMany({
      where: { id: { not: target.id } },
      data: { matchAlerts: false },
    });
    return {
      target,
      job: await resources.prisma.matchEmailDelivery.findFirstOrThrow({
        where: { eventId, recipientId: target.id },
      }),
    };
  }
  it("retries transient failures using the same immutable message and key", async () => {
    const now = new Date();
    const { job } = await queue("retry@example.com", now);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new MatchEmailSendError(true))
      .mockResolvedValue("accepted");
    expect(await deliverNextMatchEmail(resources.prisma, send, now)).toBe(
      "retry",
    );
    expect(
      await deliverNextMatchEmail(
        resources.prisma,
        send,
        new Date(now.getTime() + 6000),
      ),
    ).toBe("accepted");
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      id: job.id,
      subject: "Goal  Test",
    });
    await resources.prisma.alertRecipient.updateMany({
      data: { matchAlerts: false },
    });
  });
  it("cancels a queued message after an address edit", async () => {
    const now = new Date();
    const { target } = await queue("before@example.com", now);
    await changeAlertRecipient(resources.prisma, {
      action: "update",
      id: target.id,
      version: target.version,
      actor: "test-admin",
      settings: { ...settings, email: "after@example.com" },
    });
    const send = vi.fn();
    expect(await deliverNextMatchEmail(resources.prisma, send, now)).toBe(
      "cancelled",
    );
    expect(send).not.toHaveBeenCalled();
    await resources.prisma.alertRecipient.updateMany({
      data: { matchAlerts: false },
    });
  });
  it("expires delayed alerts without sending and permanently rejects invalid requests", async () => {
    const now = new Date();
    await queue("expired@example.com", new Date(now.getTime() - 11 * 60000));
    const send = vi.fn();
    expect(await deliverNextMatchEmail(resources.prisma, send, now)).toBe(
      "expired",
    );
    expect(send).not.toHaveBeenCalled();
    await resources.prisma.alertRecipient.updateMany({
      data: { matchAlerts: false },
    });
    await queue("reject@example.com", now);
    send.mockRejectedValueOnce(new MatchEmailSendError(false));
    expect(await deliverNextMatchEmail(resources.prisma, send, now)).toBe(
      "failed",
    );
    await resources.prisma.alertRecipient.updateMany({
      data: { matchAlerts: false },
    });
  });
  it("enables RLS with no public policy on delivery records", async () => {
    const rows = await resources.prisma.$queryRaw<
      Array<{ relrowsecurity: boolean }>
    >`SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${resources.namespace} AND c.relname='match_email_deliveries'`;
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });
});
