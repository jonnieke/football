import { expect, it, vi } from "vitest";
import { matchEmailConfig, resendMatchSender } from "./match-email-sender.js";

const config = {
  RESEND_FROM: "alerts@example.com",
  RESEND_API_KEY: "test-key-not-real",
};
const message = {
  id: "job-id",
  email: "recipient@example.com",
  subject: "GOAL",
  text: "Home 1-0 Away",
};
it("requires explicit activation and valid configuration", () => {
  expect(() =>
    matchEmailConfig({ ...config, DATABASE_URL: "postgres://localhost/test" }),
  ).toThrow();
  expect(
    matchEmailConfig({
      ...config,
      DATABASE_URL: "postgres://localhost/test",
      MATCH_EMAIL_ENABLED: "true",
    }),
  ).toMatchObject(config);
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
