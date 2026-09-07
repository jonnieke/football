import { expect, it } from "vitest";
import {
  recipientChangeSchema,
  recipientSettingsSchema,
} from "./alert-recipients.js";
const settings = {
  email: " Alerts@Example.com ",
  enabled: true,
  warnings: false,
  critical: true,
  recovery: true,
};
it("normalizes addresses and preserves notification preferences", () => {
  expect(recipientSettingsSchema.parse(settings)).toEqual({
    ...settings,
    email: "alerts@example.com",
  });
});
it.each([
  "invalid",
  "a@example.com\r\nBcc: b@example.com",
  "",
  "x".repeat(255) + "@example.com",
])("rejects invalid address %s", (email) => {
  expect(() => recipientSettingsSchema.parse({ ...settings, email })).toThrow();
});
it("rejects unknown settings, missing actor and stale-edit tokens", () => {
  expect(() =>
    recipientSettingsSchema.parse({ ...settings, admin: true }),
  ).toThrow();
  expect(() =>
    recipientChangeSchema.parse({ action: "add", settings }),
  ).toThrow();
  expect(() =>
    recipientChangeSchema.parse({
      action: "update",
      actor: "operator",
      id: "00000000-0000-4000-8000-000000000001",
      settings,
    }),
  ).toThrow();
  expect(() =>
    recipientChangeSchema.parse({
      action: "remove",
      actor: "operator",
      id: "00000000-0000-4000-8000-000000000001",
      version: 0,
    }),
  ).toThrow();
});
