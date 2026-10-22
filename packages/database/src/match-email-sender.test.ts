import { expect, it, vi } from "vitest";
import { matchEmailConfig, resendMatchSender } from "./match-email-sender.js";

const config = {
  RESEND_FROM: "alerts@example.com",
  RESEND_API_KEY: "test-key-not-real",
  admins: new Set(["recipient@example.com"]),
};
const env = { RESEND_FROM: config.RESEND_FROM, RESEND_API_KEY: config.RESEND_API_KEY };
const message = {
  id: "job-id",
  email: "recipient@example.com",
  subject: "GOAL",
  text: "Home 1-0 Away",
};
it("requires explicit activation and valid configuration", () => {
  expect(() =>
    matchEmailConfig({ ...env, DATABASE_URL: "postgres://localhost/test" }),
  ).toThrow();
  expect(
    matchEmailConfig({
      ...env,
      DATABASE_URL: "postgres://localhost/test",
      MATCH_EMAIL_ENABLED: "true",
      ADMIN_EMAILS: "recipient@example.com",
    }),
  ).toMatchObject({ RESEND_FROM: config.RESEND_FROM, RESEND_API_KEY: config.RESEND_API_KEY, admins: config.admins });
  expect(() => matchEmailConfig({
    ...env,
    DATABASE_URL: "postgres://localhost/test",
    MATCH_EMAIL_ENABLED: "true",
    ADMIN_EMAILS: "",
  })).toThrow();
});
it("blocks non-admin recipients and oversized alerts before calling Resend", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const send = resendMatchSender(config, fetcher);
  await expect(send({ ...message, email: "other@example.com" })).rejects.toMatchObject({ retryable: false });
  await expect(send({ ...message, text: "x".repeat(151) })).rejects.toMatchObject({ retryable: false });
  expect(fetcher).not.toHaveBeenCalled();
});
it("uses immutable plain text, one recipient, a stable key and bounded HTTPS requests", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() =>
      Promise.resolve(Response.json({ id: "accepted-id" })),
    );
  const send = resendMatchSender(config, fetcher);
  expect(await send(message)).toBe("accepted-id");
  await send(message);
  expect(fetcher.mock.calls[0]).toEqual([
    "https://api.resend.com/emails",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal) as unknown,
      headers: expect.objectContaining({
        "Idempotency-Key": "match-alert/job-id",
      }) as unknown,
      body: JSON.stringify({
        from: config.RESEND_FROM,
        to: [message.email],
        subject: message.subject,
        text: message.text,
      }),
    }),
  ]);
  expect(fetcher.mock.calls[1]?.[1]?.body).toBe(
    fetcher.mock.calls[0]?.[1]?.body,
  );
});
it.each([
  [429, true],
  [500, true],
  [403, false],
  [422, false],
])(
  "classifies status %s without exposing provider details",
  async (status, retryable) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("private details", { status: Number(status) }),
      );
    await expect(
      resendMatchSender(config, fetcher)(message),
    ).rejects.toMatchObject({
      message: "MATCH_EMAIL_PROVIDER_ERROR",
      retryable,
    });
  },
);
