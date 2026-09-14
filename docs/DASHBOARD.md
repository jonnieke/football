# Football Control Room

## Shared API connection verified — 2026-09-08 17:00 EAT

The API Redis cutover is complete. `api-1lc3` production deployment `dpl_7FXkCQHinwfWJJAsPFr2ruZ7JpgY` now uses the same encrypted Aiven Redis as this dashboard and the workers. During a supervised four-request Premier League poll, the public API reported all services healthy. The poll succeeded with zero eligible fixtures; all workers were then stopped. See `LOCAL_WORKERS.md` for verification and rollback details. Older pending-cutover notes below are historical. The dashboard's warning that it cannot independently verify other deployments' configuration remains valid.

## Redis sign-in repair — 2026-09-08

Production deployment `dpl_4Crz1xyTE3R9hDrxNf9QJMmKPhMY` replaces idle Redis socket reuse with request leases. Overlapping requests share one connection; the last completed response disconnects it. A failed connection is discarded after the failed requests complete, so the next request starts fresh. Commands are never automatically replayed, preserving one-time-token semantics. Connection errors log only allowlisted categories, never credentials or addresses. API and worker Redis behavior is unchanged.

Verification: 20 administrator tests passed, TypeScript and targeted ESLint checks passed, remote build reached READY, separate protected endpoint checks returned the expected sign-in-required response, and a public `/auth/request` submission with a non-approved test address succeeded without sending email. No errors appeared in the new deployment's post-check logs. Actual approved-email delivery and user sign-in still require user verification. `/health` remains a liveness check, not a database or Redis readiness guarantee.

## Current implementation

The existing `apps/admin` application now includes a read-only operational dashboard alongside alert-recipient management. All operational data is behind the same approved-admin, email-link session check as recipient settings. Browser assets contain no connection strings or API keys. Responses are `no-store`; source strings are rendered with `textContent`, not HTML.

`GET /api/dashboard` reads the admin application's own database and Redis configuration. It does not call API-Football, start workers, publish content, alter queue jobs, or change database rows. Redis authentication/rate-limit bookkeeping remains part of existing sign-in protection.

The snapshot includes:

- Database/queue connectivity and worker heartbeat timestamps.
- Up to 50 enabled leagues, 10 recent polling runs, 20 stored fixtures and 20 content previews.
- Pending unpaused work, paused work and pending source reviews.
- Explicitly unknown API quota: automatic capture of provider allowance is not implemented yet.

Database reads use a read-only repeatable-read transaction with a statement timeout and bounded transaction duration. Concurrent requests share a ten-second snapshot cache per process. Browser refresh is manual; the page displays the snapshot time. A missing signal cannot distinguish intentional shutdown from disconnection. A recent heartbeat is not proof a job completed. Empty match results are not proof there are no scheduled matches outside the ingestion discovery window. If Redis authentication storage is unavailable, access fails closed; an external monitor is still needed for total outages.

## Recommended testing arrangement

Keep Supabase as the database; use the already tested TLS-enabled Aiven Valkey service for shared queues/heartbeats; host the admin app and API on Vercel. Workers still need an active runner; the dashboard is not a worker host.

Aiven's free plan is suitable for testing, not an uptime promise: it has no 99.99% SLA and inactive services may be powered off. See [Aiven's free-tier limits](https://aiven.io/docs/products/valkey/concepts/valkey-free-tier). Reassess capacity, backups and availability before production.

The existing Vercel API still uses the earlier Redis service. The deployed dashboard uses Aiven and the intended Supabase database. It cannot certify that other deployments share its connections; its UI says so. Only the new administrator project's environment was configured; the API's environment remains unchanged.

## Before publishing

1. Configure the admin deployment using `ADMIN_AUTH.md`: fixed HTTPS `ADMIN_ORIGIN`, approved `ADMIN_EMAILS`, unique `ADMIN_NAMESPACE`, working `RESEND_FROM` and private `RESEND_API_KEY`. The dashboard is now published; a setup email was accepted by Resend. User confirmation of inbox delivery and actual magic-link sign-in is still pending.
2. Use the intended Supabase database, verified PostgreSQL TLS and the Aiven `rediss://` connection server-side. Keep the required CA configuration. Set `QUEUE_PREFIX` to the workers' namespace (`bull` currently). `ADMIN_NAMESPACE` is for login sessions and is not the worker queue prefix.
3. Before switching the Vercel API Redis URL, inspect old queues and ensure no workers are writing there. Capture a private rollback configuration. A switch changes caches, rate-limit state and any sessions using that service; it does not migrate them. Do not delete the old Redis service or assume changing a URL moves jobs.
4. Redeploy and verify authorized and unauthorized dashboard access, both service connections, worker signals while running, graceful shutdown, and a real processed match event. Use isolated services for preview deployments.

Do not expose Supabase tables via its browser Data API to enable this dashboard. Existing RLS and grants are unchanged. A dedicated least-privileged database role remains recommended.

## Verification tools

With Node 24 from the repository root:

```text
node --import tsx scripts/dashboard-live-check.mjs
node --import tsx scripts/dashboard-preview.mjs
```

The live check is read-only and targets this computer's configured project and public CA. It verified both connections, one enabled league, a succeeded poll, zero fixtures/content/pending work, and missing worker heartbeats on 2026-09-08. It made zero provider requests.

The preview binds only `127.0.0.1:3187`, uses clearly labelled **example data**, loads no secrets, rejects all mutations, and stops after 15 minutes. Its mock session endpoint is only in the separate offline preview script, never in the admin application. It does not test live login or deployment. Never deploy that preview script.

## Deployment preparation — 2026-09-08

The local Vercel CLI is authenticated and can access the correct team. The API folder is linked to `api-1lc3` (`prj_k3fQeCGXMGRc9epi1s93X8ccX6SI`). The connected Vercel app lists only `sinema-sasa`; use the verified CLI access for the football project, and do not deploy to the unrelated project.

The API's production environment contains the original five required API settings but no Resend key. A Git-ignored `.env.admin.local` has been prepared for the user to enter the key privately. Never commit, display, or include this file in an upload. The temporary `onboarding@resend.dev` sender is for testing to the Resend account owner's email only; other recipients require an appropriately verified sending domain.

For a **separate administrator project** (do not replace the API):

| Setting                              | Value                                   |
| ------------------------------------ | --------------------------------------- |
| Root Directory                       | `apps/admin`                            |
| Include files outside Root Directory | Enabled                                 |
| Framework                            | Other                                   |
| Node.js                              | 24.x                                    |
| Install/build/output                 | Use checked-in `apps/admin/vercel.json` |

`pnpm build:vercel apps/admin` builds and packages the admin handler, then verifies the artifact in an isolated temporary folder without live credentials. `pnpm verify:vercel apps/admin` repeats that check. The handler reuses initialized clients per instance, does not listen on a port, and retries initialization after failure while returning a generic non-cacheable 503 response. Sixteen admin tests pass, including the serverless retry and warm-instance test.

Build the actual deployment on Vercel/Linux, not by uploading a Windows-generated native dependency package. Do not change the API Redis connection until the old queues are checked and a valid rollback path is established. The deployment record below supersedes the earlier preparation-only status.

The local administrator Build Output API package passed isolated verification: handler import, generic configuration-failure response, page/assets, and denial of unauthenticated dashboard access. The admin package now includes `dist` and the public `certs` directory. TypeScript and lint checks passed. With `DATABASE_CA=supabase-2021`, the runtime uses the packaged public CA and `sslmode=verify-full`; certificate verification is not disabled.

## Live deployment — 2026-09-08

- Project: `football-control-room`, ID `prj_tDmBx3jZsAhDkSNfw42ptCe4A6kS`, under the existing team. The API project was not replaced.
- Public sign-in: <https://football-control-room.vercel.app/login>.
- Deployment: `dpl_5AvmruTaCNqB1NXdtJBBbaGGqpZG`; immutable URL <https://football-control-room-co0i8ivfo.vercel.app>.
- Vercel/Linux source build completed READY, then was promoted after `/health` and denied unauthenticated `/api/dashboard` checks.
- Public browser check confirmed the sign-in page and controls render without recorded page errors.
- Ten server-side settings were saved for production only through the CLI. Local secret files and Windows build outputs were excluded by `.vercelignore`. No secret values were printed.
- One setup-confirmation email was accepted by Resend (HTTP 200), addressed to the approved Gmail account. This is not proof of inbox delivery or successful magic-link login; the user must complete login in their own browser.
- The deployment used the local working tree; these changes have not been committed/pushed. Automatic GitHub deployment linkage remains to be configured/verified.

### API Redis cutover is not complete

The API's five existing Vercel variables are `sensitive` and cannot be exported with usable values. `.env.api-before-redis.local` therefore has **blank application credentials and is not a usable rollback backup**. It also contains temporary Vercel metadata; keep it private. The old-queue check stopped at its target guard without connecting or changing any queues. Obtain the original old Redis URL privately before inspecting the old queues and proceeding, or explicitly review an alternative rollback/cutover plan. Never treat this export as a valid rollback file.

No API variables, API deployments, old Redis data, database schema, or worker processes were changed during this dashboard deployment. The dashboard reads the same Aiven service used by the local worker tests; the API still reads its old service.
