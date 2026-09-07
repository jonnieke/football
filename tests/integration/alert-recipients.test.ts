import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { changeAlertRecipient, listAlertRecipients } from "@fcp/database";
import { createTestResources } from "../support/resources.js";
import { schemaIdentifier } from "../support/isolation.js";
const suite =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("audited alert recipient changes", () => {
  let resources: Awaited<ReturnType<typeof createTestResources>>;
  beforeAll(async () => {
    resources = await createTestResources(process.env);
  }, 90000);
  afterAll(async () => {
    await resources?.cleanup();
  }, 30000);
  const settings = {
    email: "alerts@example.com",
    enabled: true,
    warnings: true,
    critical: true,
    recovery: true,
  };
  it("adds, edits, rejects stale writes, disables and removes while preserving audit history", async () => {
    const { prisma } = resources;
    const added = (await changeAlertRecipient(prisma, {
      action: "add",
      actor: "operator-a",
      settings,
    }))!;
    expect(added.version).toBe(1);
    await expect(
      changeAlertRecipient(prisma, {
        action: "add",
        actor: "operator-b",
        settings: { ...settings, email: " ALERTS@EXAMPLE.COM " },
      }),
    ).rejects.toThrow();
    const results = await Promise.allSettled(
      [false, true].map((warnings) =>
        changeAlertRecipient(prisma, {
          action: "update",
          id: added.id,
          version: 1,
          actor: "operator-a",
          settings: { ...settings, warnings },
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await prisma.alertRecipientAudit.count({
        where: { recipientId: added.id },
      }),
    ).toBe(2);
    const edited = (await changeAlertRecipient(prisma, {
      action: "update",
      id: added.id,
      version: 2,
      actor: "operator-a",
      settings: { ...settings, email: "new@example.com", enabled: false },
    }))!;
    expect(edited.email).toBe("new@example.com");
    expect(edited.enabled).toBe(false);
    await expect(
      changeAlertRecipient(prisma, {
        action: "remove",
        id: added.id,
        version: 1,
        actor: "operator-a",
      }),
    ).rejects.toThrow();
    await changeAlertRecipient(prisma, {
      action: "remove",
      id: added.id,
      version: 3,
      actor: "operator-a",
    });
    expect(await listAlertRecipients(prisma)).toEqual([]);
    const audit = await prisma.alertRecipientAudit.findMany({
      where: { recipientId: added.id, action: "remove" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.before).toMatchObject({
      email: "new@example.com",
      enabled: false,
      version: 3,
    });
    expect(audit[0]?.after).toBeNull();
  });
  it("rolls back recipient writes if audit insertion fails", async () => {
    const { prisma, namespace } = resources;
    const schema = schemaIdentifier(namespace);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${schema}.alert_recipient_audit ADD CONSTRAINT reject_test_actor CHECK (actor <> 'reject-test')`,
    );
    await expect(
      changeAlertRecipient(prisma, {
        action: "add",
        actor: "reject-test",
        settings,
      }),
    ).rejects.toThrow();
    expect(await listAlertRecipients(prisma)).toEqual([]);
  });
});
