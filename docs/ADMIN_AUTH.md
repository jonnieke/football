# Admin settings and Resend login links

The standalone Fastify admin app now serves `/login`, `/auth/confirm` and `/settings`.
Settings provide recipient add/edit/remove, notification preferences, pagination,
and the latest 100 audit entries per recipient. All data routes require a valid
approved-admin session. The API partner key never grants administrative access.

## Deployment and configuration

This is a separate Node service, not part of the current API-only Vercel deployment.
Deploy it behind HTTPS on a dedicated administrator origin. Use a host that runs
the compiled Node entry point (`pnpm --filter @fcp/admin start`), or implement and
verify a separate serverless adapter before using Vercel Functions. Do not run a
persistent HTTP listener inside the existing API function. This change does not
provision a host, change DNS, or configure live credentials.

Apply the recipient migration through the operator rollout procedure, install
dependencies and run `pnpm build` before starting the admin app. Configure these
server-only variables through your host's secret settings (never in source control):

The production entry point reads process environment only; it does not auto-load
local `.env` files. Supply local variables explicitly when developing.

| Variable                | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| DATABASE_URL            | Intended application database/schema; recipient and audit access    |
| REDIS_URL               | Private Redis with TLS in production; auth state and rate budgets   |
| NODE_ENV                | `production` (default when omitted in admin configuration)          |
| ADMIN_ORIGIN            | Exact HTTPS origin, e.g. `https://admin.example.com`; no path/query |
| ADMIN_NAMESPACE         | Unique environment namespace, 3–64 letters/digits/underscore/hyphen |
| ADMIN_EMAILS            | Comma-separated approved administrator addresses, maximum 50        |
| RESEND_FROM             | Plain sender address on your Resend-verified domain                 |
| RESEND_API_KEY          | Resend sending key, scoped to the sender domain where possible      |
| ADMIN_HOST / ADMIN_PORT | Defaults `127.0.0.1` / `3001`; bind appropriately behind the proxy  |

The configuration rejects empty/invalid admin lists and unsafe origins. Never
reuse production credentials or namespace in previews. For local development only,
NODE_ENV=development/test permits HTTP on localhost/127.0.0.1. Production always
uses Secure `__Host-` cookies, with Path=/ and no Domain attribute.

Verify the sender domain in Resend and disable click tracking for login email links;
do not wrap these authentication URLs in analytics redirects. The sender uses the
[Resend email API](https://resend.com/docs/api-reference/emails/send-email), plain
text, a five-second timeout, no redirects, and an idempotency key per token. It does
not retry automatically. Acceptance by Resend is not proof of inbox delivery. Mail
sender failures emit `ADMIN_LOGIN_EMAIL_FAILED` without printing the key, address,
link or provider response. No live Resend request was made during development.

## Sign-in security and operating limits

- Admin requests a login link, receives a ten-minute browser-binding cookie, and
  opens the email in that same browser profile. A different device/profile fails.
- Links contain a 256-bit random token in the URL fragment, not the query string.
  Confirmation JavaScript removes the fragment from browser history before doing
  anything else. GET never consumes a link; an explicit confirmation POST is required.
- Redis stores only token hashes in keys and a hashed browser binding. Atomic Lua
  checks that binding and consumes the link once. The resulting opaque session is
  stored server-side for eight hours; its cookie is HttpOnly, SameSite=Strict and
  Secure in production. No credentials are stored in browser localStorage.
- Requesting another link resets the browser binding. Use the newest email. Email
  scanners cannot sign in merely by visiting the link. A user opening an email in
  the same browser still must confirm the login; GET landing alone does not consume it.
- Logout deletes the current session. The allowlist is checked for every protected
  request and redemption. Removing an admin requires updating ADMIN_EMAILS and
  restarting/redeploying **all** admin instances; stale instances retain their loaded
  configuration. Rotating ADMIN_NAMESPACE revokes all sessions/links once all
  instances use it. Old keys expire naturally.
- Every POST requires the exact configured Origin, JSON, and the custom admin
  request header. No CORS is enabled. Responses disable caching; CSP forbids inline
  scripts, external resources and framing. Audit text is rendered with textContent.
- Rate budgets: 120 auth/API requests per IP per minute; 10 login requests per IP
  per ten minutes; 3 login emails per address and 60 total per ten minutes. Redis
  failures fail closed. Forwarded IP headers are not trusted. Behind a proxy/NAT,
  users may share a budget; configure an audited trusted-proxy policy before scaling.
- Valid but unapproved addresses, exhausted email budgets and mail-provider failures
  receive the same generic login response. This is not a constant-time guarantee.
- Raw request logging is disabled; error logs contain fixed codes, never tokens or
  database details. Ensure proxy/access logs, analytics, request-body capture and
  support tools also exclude cookies and authentication request bodies.

Email login inherits the security of the approved mailboxes. It is not phishing-
resistant MFA. Protect those mailboxes with MFA; consider a managed identity provider
or additional authentication for broader/more sensitive administration. Redis is
security-critical: isolate it, restrict ACLs and protect its backups. Auth Redis
loss logs everyone out. A token consumed immediately before a session-write failure
requires a new login link; the app does not bypass auth to recover that attempt.

The recipient-change actor is derived from the server session, overriding any actor
sent by a client. Existing atomic audit/version checks still apply. All approved
admins currently have the same recipient-management permission. Removal does not
erase address history; see ALERT_RECIPIENTS.md for privacy/retention limitations.

## Verification and remaining delivery work

Unit/API tests cover wrong origins, unauthorized reads, allowlists, expiry, browser
binding, single-use links, session revocation, rate limits, provider failure, forged
actors and edit conflicts. Isolated Redis/PostgreSQL tests exercise real atomic
redemption, expiry, and authenticated recipient/audit writes. Browser verification
uses `pnpm exec tsx scripts/admin-preview.ts`, a loopback-only synthetic harness
with an in-memory store and fake inbox. That harness is never imported or bundled
by the production entry point; never deploy scripts/admin-preview.ts.

The browser walkthrough confirms request → confirmation → protected page → add/edit
preferences → history → logout. No live sender, real-mailbox arrival, hosted admin
origin or production-store connection has been verified. Scheduled monitoring email,
duplicate suppression, incident recovery notifications, test-alert sending, recipient
verification and bounce/delivery webhooks remain separate, unimplemented work.
