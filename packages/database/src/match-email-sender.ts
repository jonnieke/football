import { z } from "zod";
import { MatchEmailSendError, type MatchEmailSend } from "./match-email.js";
import { MAX_ADMIN_ALERT_LENGTH } from "@fcp/content-core";

export function matchEmailConfig(env: NodeJS.ProcessEnv) {
  const parsed = z
    .object({
      DATABASE_URL: z.url(),
      MATCH_EMAIL_ENABLED: z.literal("true"),
      RESEND_FROM: z.email(),
      RESEND_API_KEY: z.string().min(10),
      ADMIN_EMAILS: z.string().min(1),
    })
    .safeParse(env);
  if (!parsed.success)
    throw new Error("Match email sending is disabled or misconfigured");
  const admins = z.array(z.email()).min(1).max(50).safeParse(
    parsed.data.ADMIN_EMAILS.split(",").map((item) => item.trim().toLowerCase()),
  );
  if (!admins.success) throw new Error("Invalid administrator alert allowlist");
  return { ...parsed.data, admins: new Set(admins.data) };
}

export function resendMatchSender(
  config: Pick<
    ReturnType<typeof matchEmailConfig>,
    "RESEND_FROM" | "RESEND_API_KEY" | "admins"
  >,
  fetcher: typeof fetch = fetch,
): MatchEmailSend {
  return async (message) => {
    if (
      !config.admins.has(message.email.toLowerCase()) ||
      message.text.length > MAX_ADMIN_ALERT_LENGTH
    )
      throw new MatchEmailSendError(false);
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `match-alert/${message.id}`,
      },
      body: JSON.stringify({
        from: config.RESEND_FROM,
        to: [message.email],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new MatchEmailSendError(
        response.status === 429 || response.status >= 500,
      );
    }
    const result = z
      .object({ id: z.string().min(1).max(200) })
      .safeParse(await response.json());
    if (!result.success) throw new MatchEmailSendError(true);
    return result.data.id;
  };
}
