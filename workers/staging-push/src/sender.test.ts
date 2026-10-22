import { describe, expect, it, vi } from "vitest";
import { mysqlStagingSender, stagingPushConfig } from "./sender.js";

const message = {
  id: "delivery-1",
  text: "GOAL 67': Arsenal 2-1 Chelsea.",
  menuCmd: "LIVESCORES",
  uploadedBy: "Football Content Platform",
};

describe("staging push MySQL sender", () => {
  it("uses the supplied staging-table contract with parameterized values", async () => {
    const execute = vi.fn().mockResolvedValue([{ insertId: 42 }]);
    await expect(mysqlStagingSender(execute)(message)).resolves.toBe("42");
    expect(execute).toHaveBeenCalledWith(
      "INSERT INTO content_schedual_allday (message, MenuCMD, MessagePushTime, UploadedBy) VALUES (?, ?, NOW(), ?)",
      [message.text, "LIVESCORES", "Football Content Platform"],
    );
  });

  it("treats the receiver's duplicate rejection as successful delivery", async () => {
    const execute = vi
      .fn()
      .mockRejectedValue({ code: "ER_DUP_ENTRY", errno: 1062 });
    await expect(mysqlStagingSender(execute)(message)).resolves.toBe(
      "duplicate:delivery-1",
    );
  });

  it("fails closed unless explicitly enabled with a MySQL URL", () => {
    expect(() => stagingPushConfig({})).toThrow(/disabled/);
    expect(() =>
      stagingPushConfig({
        STAGING_PUSH_ENABLED: "true",
        STAGING_DATABASE_URL: "postgresql://user:pass@example.com/db",
      }),
    ).toThrow(/MySQL/);
  });
});
