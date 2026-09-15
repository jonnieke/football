# Automatic match email alerts

The agreed delivery sequence is dashboard, partner API, then email. All three
implementations are built. Admin controls and database migrations went live on
2026-09-15; partner streaming is also deployed, but persistent senders remain stopped.
One labelled test email was accepted by Resend; inbox receipt is unconfirmed.
See [release evidence](RELEASE_2026-09-15.md). Ongoing sending remains disabled.

## Administrator controls

In **Alert recipients**, add/edit an address and explicitly check **Match alerts**.
The recipient must also be **Enabled**. Existing recipients default to match alerts
off. System warnings/critical/recovery preferences are separate and their sender
is not implemented by this change. Add only recipients who agreed to receive alerts.

Changes are audited, use optimistic version checks, and retain the existing
approved-admin session and same-origin protection. Maximum 100 active match-alert
recipients. An edit (including a preference edit), removal, or disable cancels queued
jobs from the previous recipient version when the sender next checks them. A send
already in progress cannot be recalled. New addresses receive future events only.

**Recent match email activity** shows the latest 50 jobs, address, subject, attempts,
status, and safe failure code. Refresh manually. `accepted` means the email provider
accepted the request, not confirmed inbox delivery. Bounce/complaint webhooks,
recipient self-service unsubscribe and public mailing-list signup are not included;
this first version is an administrator-managed, consenting operational audience.

## Pipeline and reliability

Fresh automatic content publication and email-job insertion commit together.
Drafts, manual historical approval, and old content do not enqueue emails. Enabled
league coverage controls automatic publication; already queued notifications remain
eligible if a league is subsequently paused. Pause a recipient to stop their queue.

Jobs contain an immutable subject/body/address snapshot. One event/recipient pair
has one durable job, independent of content channel variants. Email network calls
happen in a separate sender, never in API requests or publication transactions.
Resend/network failures do not hold up the live feed; a database failure in the
atomic publication transaction does roll back both publication and enqueue.

The sender claims a job for 60 seconds using an atomic conditional update. Each
HTTPS attempt times out after ten seconds. Retries use the same job-based Resend
idempotency key, with 5/10/20/40/80-second backoff and a maximum of six attempts.
429 and 5xx responses retry; other HTTP errors are recorded as failed. Unknown
network outcomes retry with the same key. A crash after provider acceptance but
before database acknowledgement therefore does not deliberately create a new key.
Alerts expire ten minutes after publication; delayed old alerts are not sent.

Resend retains idempotency keys for 24 hours, longer than this retry lifetime.
Do not change `RESEND_FROM` while retryable jobs are outstanding: it is part of the
provider request and changing it conflicts with the existing idempotency payload.
Never manually reset old jobs to pending; their keys may have expired at Resend.
See [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Runtime and rollout

Migration: `20260915105615_match_email_delivery`, following the previously prepared
league-controls migration. It adds `match_alerts=false` and a private indexed delivery
table with RLS and revoked public/client-role access. There is no historical backfill.
Deploy the migration before new admin/content-worker code. Retain existing backup
and rollback procedures; do not drop the delivery ledger during a rollback.

The opt-in process is `pnpm alerts:matches --run`. It requires explicitly supplied
`DATABASE_URL`, `MATCH_EMAIL_ENABLED=true`, `RESEND_FROM`, and `RESEND_API_KEY`.
It does not load dotenv files implicitly and is not part of `pnpm dev` or Vercel
request handling. Running `pnpm alerts:matches` without `--run` sends nothing.
Keep credentials server-side, never in browser configuration or source control.

Run one supervised sender alongside persistent workers, not as a long-lived Vercel
request. It processes one job per second plus send time. Multiple recipients create
separate sends; bursts can queue. Check Resend account/domain permissions, quota,
costs, and expected volume before enabling. Inbox delays are outside our control;
the live API remains the primary low-latency integration channel.

Before production: review the migration, verify backups, test sender-domain delivery
to one consenting recipient, set sending budgets and supervision, and verify the
admin accepted/failure records. For public-scale email, add self-service unsubscribe,
verified bounce/complaint suppression, delivery webhooks, retention policy, and shared
provider rate limiting. No scheduled task or production process was created here.

## Verification

Disposable local PostgreSQL/Redis integration tests verified fresh-only atomic
enqueue, concurrent delivery deduplication, retries, recipient edits, expiry,
permanent rejection, and RLS enabled. Existing content-approval and recipient-audit
tests passed. Sender HTTP tests use a fake fetch; no real Resend calls.
Browser verification used the actual admin routes with a disposable database:
add recipient → enable match alerts → simulated goal → fake sender → accepted status.
The page rendered and had no reported browser errors. Admin authorization, build,
TypeScript and targeted lint checks passed.
