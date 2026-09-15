# Local worker testing on Windows

The local bounded trials below are historical. Since 2026-09-15 17:22 EAT,
the four football workers run continuously on Google VM `fcp-workers-1`;
the match email sender remains off. See GOOGLE_CLOUD_WORKERS.md for current
hosting and verification. Do not start a second local collector against the
same production Redis/database while the cloud collector is running.

## Corrected worker build — live verification, 2026-09-15 15:48 EAT

Rebuilt all four workers and dependencies with the quiet-poll freshness fix. The
compiled database package contains immutable `previousObservedAt` handling; SHA256
`2c0ca06795d36eff99b1a1f997676092448a8f2e247c4e9fa767806beb3b0705`.
Offline request-cap tests and read-only preflight passed; launch verified nine
migration checksums, the intended league and empty queues before starting.

The bounded `--live-trial` completed two successful polls:

- 12:48:25.715–12:48:35.523 UTC, three fixtures, zero changed.
- 12:49:06.276–12:49:15.596 UTC, three fixtures, zero changed.
- Sixteen provider requests, all HTTP 200; final reported shared allowance 74,437.
- Live Vercel health returned 200 with every listed service healthy during the run.
- Records stayed at three fixtures, 16 events, 16 reports (15 drafts, one published).
  Pending outbox remained zero. No new live event or publication was demonstrated.
- All four worker processes exited zero. Independent process inspection found none
  remaining; the ingestion lock was absent. Heartbeats linger until their TTL expires.

This verifies operation of the corrected compiled workers against live services,
not continuous hosting or new-event latency. The earlier isolated tests verified
the quiet-period publication behavior. No migration, cloud resource, email sender,
scheduled startup or ongoing worker service was created. Continuous host selection
remains an operator decision.

## Automatic-reporting bounded trial — 2026-09-15 15:30 EAT

Rebuilt the four workers and dependencies with Node 24. New `--live-trial` mode
uses 30 seconds between completed polls, caps provider calls at 24, requires two
successful cycles, retains the 90-second observation / 145-second hard shutdown
limits and independently bounded children. It verifies all nine migration checksums,
Premier League 39 / season 2026, no existing work/worker locks, and no enabled match
email recipients or pending email jobs. No email sender is started. Eligible fresh
publication is allowed; this is not the older draft-only test. Offline request-guard
self-tests and ESLint passed. Existing `--run` behavior is retained for legacy testing.

Results:

- Successful polls at 12:30:35.824–12:30:45.934 UTC and
  12:31:16.686–12:31:26.494 UTC. Both retrieved three fixtures, zero changed.
- Sixteen provider requests, all HTTP 200. Last reported allowance 74,465;
  provider-reported values varied and are not a platform-exclusive usage counter.
- Vercel `/v1/health` returned 200 with database, Redis, provider and all four
  workers healthy during the run.
- Fixtures/events/content remained 3/16/16; pending outbox zero. Post-run state:
  15 drafts, one published report, one manual approval, feed high-water one.
  No new publication is demonstrated by this trial; there were no changed fixtures.
- All four processes exited zero. Independent process inspection found no worker
  processes; ingestion lock absent. Recent Redis heartbeats linger until expiry and
  must not be mistaken for continued operation.

This is not 24/7 hosting or a verified source-to-subscriber event test. Fix the
unchanged-snapshot freshness gap described in AUTOMATIC_REPORTING.md before relying
on unattended publication. No email was sent and no scheduled startup was installed.

The remaining sections are historical records, not the current rollout status.

## Consumer-only backlog completion — 2026-09-15

With explicit operator approval, processed the 13 remaining `content_generation`
outbox records from the preceding trial. Read-only preflight found three drafts,
zero published items/approvals, no paused tasks, and empty Redis job queues. No
other worker signals or ingestion lock were present.

Started only event-processor, content-generator and outbox-dispatcher, using the
rebuilt release and existing child HTTP guards (all fetch requests prohibited for
these workers). No ingestion worker or email sender was started. The supervisor
allowed 100 seconds before graceful shutdown and a 118-second force cutoff.

Verified at 2026-09-14 22:59:33 UTC / Sep 15 01:59:33 EAT:

- Finished in 35 seconds; all three processes exited with code 0.
- Pending and paused outbox records: zero.
- Both queues: zero waiting, active, paused, delayed, prioritized, waiting-child,
  or failed jobs.
- Drafts increased from 3 to 16. Published items and approvals remain zero;
  feed high-water remains zero.
- Poll count stayed at three. No additional API-Football requests were made.
- Independent process check found no remaining workers. No records were manually
  deleted or approvals performed. Normal successful-job completion is not a purge.

The historical 13-task backlog below is now resolved. All workers remain stopped.
Next is operator review of drafts; live publication still requires a separate,
specific approval decision.

## Latest bounded draft-first trial — 2026-09-15

Operator-approved limit: 12 provider requests, 90-second monitoring window, 145-second
supervisor cutoff, no publication or email. Rebuilt all four workers and dependencies
with Node 24 from release `6549ab6`; offline request-guard tests passed. All seven
database migrations matched before launch. Preflight found no pending work or other
worker signals and only Premier League 39, season 2026, enabled.

- Poll `01a0a217-7f73-7767-badb-6a63a223dce0` succeeded, 2026-09-14
  22:44:04.163–22:44:18.023 UTC (Sep 15, 01:44 EAT).
- Seven provider requests, all HTTP 200; three fixtures retrieved and changed.
  Last response reported 74,127 requests remaining (shared provider allowance).
- After graceful shutdown: three fixtures, 16 canonical events, three content items,
  all **draft**; zero approvals and feed high-water still zero.
- Thirteen outbox records remain pending. This was a bounded test, not a full queue
  drain; do not describe the whole workload as completed. Do not rerun the existing
  smoke-test launcher unchanged: it intentionally refuses existing pending work.
- All four child processes exited with code 0. Independent local process check found
  no remaining test workers; ingestion lock was absent. Heartbeats were still present
  immediately afterwards and will expire; they do not prove continued operation.
- No approval action, email sender, fake fixture/job, or continuous service was started.
  No queue or database data was deleted. The live generated-content path produced
  drafts, but live approval/feed delivery still needs separately authorized verification.

Next: inspect the three drafts in the dashboard. A separate consumer-only bounded
drain can process the remaining work without provider polling, after explicit approval
and inspection of that pending workload. Historical sections below describe earlier runs.

## Current status

**Update at 17:00 EAT, 2026-09-08:** API `api-1lc3`, dashboard and local workers now use the same Aiven Redis. The second supervised worker test passed and all four child processes exited with code 0. They are not running continuously. Earlier notes below describing the Redis mismatch and an unverified supervisor correction are historical and superseded by this result.

## Redis cutover and second worker test

- Read-only checks found zero queued/failed jobs, worker signals and ingestion locks in both the old Redis Cloud database and target Aiven database. No Redis data was deleted or migrated. The private old connection is retained in `.env.redis-before-cutover.local` (gitignored); the earlier Vercel export with blank sensitive values is not a rollback backup.
- The pre-cutover API deployment is `dpl_26ggT2z2UtaMctDnMYAZbWTKsVgU`. Only its production `REDIS_URL` was updated, retaining sensitive storage and production-only scope. CLI `env update` rejected the sensitive variable with a key-change error; a value-only PATCH to the exact environment variable succeeded. No other API configuration was changed.
- The same API source was rebuilt as production deployment `dpl_7FXkCQHinwfWJJAsPFr2ruZ7JpgY`, serving `https://api-1lc3.vercel.app`. The previous deployment and old Redis service remain available for rollback; restoring the project environment value is a separate action from moving the domain back.
- All worker packages and dependencies were rebuilt with Node 24. Offline request-limit tests and read-only preflight passed. The supervised test made four provider requests, all HTTP 200, with 74,438 requests remaining on the last response (a shared allowance, not a platform-only usage meter).
- Saved poll `01a08150-ec64-71b8-a501-47dedf4572df` succeeded at `2026-09-08 13:59:19.471` to `13:59:23.764` UTC (16:59 EAT), retrieving zero eligible fixtures. Fixture/event/content/pending-outbox counts remained zero. Actual fixture-to-content processing is still untested.
- During the test, the public API `/v1/health` returned HTTP 200 with database, Redis, provider and all four workers healthy. This verifies that the API can see the workers' shared Redis signals.
- All four worker processes exited normally; read-only verification confirmed the saved poll and released ingestion lock. Heartbeats remain briefly until expiry, so recent status does not imply continued operation.
- Post-deploy logs contained a Fastify `FSTDEP023` deprecation warning, not a failed health request. Updating the old API source's logging configuration is follow-up work. Long-idle API Redis connection behavior remains a reliability item; the dashboard's request-scoped connection repair is not part of this same-source API redeploy.
- The cutover checker now accepts Redis Cloud's documented dynamic `.db.redis.io` endpoints: https://redis.io/docs/latest/operate/rc/databases/connect/ .

A supervised live worker smoke test was completed on 2026-09-08; all four worker processes were stopped afterwards. The offline readiness check itself never starts workers, migrations, seeds, or polling. The Vercel API remains hosted remotely and its configuration was not changed. Docker is not required with the configured remote services.

## Private configuration

Use `.env.workers.local` in the repository root. Existing `.gitignore` rules exclude it; never force-add it to Git or share screenshots showing its contents. It is a plaintext file, not an encrypted vault: keep the Windows account and disk protected.

Fill `DATABASE_URL`, `REDIS_URL`, `API_FOOTBALL_KEY`, and `CURSOR_SIGNING_SECRET` privately with the project's saved values. Keep quotation marks around values. URL-encode reserved characters within connection-string passwords. `API_FOOTBALL_BASE_URL` is `https://v3.football.api-sports.io`. Do not use Supabase API keys or an HTTPS Redis REST endpoint in place of connection strings.

The prepared file uses a 300-second live interval, daily discovery, zero provider retries, and a reconciliation batch size of five. These are conservative settings, NOT a daily request cap: each cycle can call multiple endpoints and request events for multiple fixtures. The ingestion loop starts polling immediately when launched.

If the file is missing, create it privately with those settings and `NODE_ENV=production`, `LOG_LEVEL=info`, `QUEUE_PREFIX=bull`. Never copy unrelated project secrets.

## Offline check

With Node.js 24 on PATH, run `pnpm workers:check` from the repository root. This checks file configuration and the presence of worker build artifacts, without connecting to services or printing credential values. A successful check does not verify artifact freshness or grant approval to start.

On the current computer, a bundled Node.js 24 runtime is available. In PowerShell, from `D:\software\football-content-platform`, the equivalent check is:

```powershell
& 'C:\Users\peterson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --import tsx scripts/workers-check.ts
```

This absolute runtime path is specific to this computer. System Node.js is currently 22; do not use it for the worker build or launch. Bundled runtime paths can change after app updates.

## Required review before launch

1. Confirm the API-Football plan, remaining daily requests, covered seasons/leagues, and a bounded testing window. No live provider calls merely to inspect configuration without approval.
2. Verify database migrations with a read-only check. Database health only confirms connectivity, not that all application tables exist. Do not automatically migrate or seed the remote database.
3. Inspect enabled competitions and pending work read-only. Reusing the Vercel database/Redis is a live-data test: workers write records and can process existing queued jobs. A different Redis prefix alone does not isolate database writes.
4. Confirm the queue prefix matches the API for a shared test. A separate sandbox needs its own database/schema and Redis namespace.
5. Review Redis memory, persistence, connection allowance, and `noeviction` suitability for BullMQ. Local workers now use TLS-enabled Aiven Valkey, verified with `noeviction` and approximately 299 MiB maximum memory. Vercel still uses the earlier Redis service: these environments are not yet aligned. Do not assume a free service has production-level availability or sufficient capacity under load.
6. Build the repository with Node.js 24. Then explicitly approve a short worker run after the above checks. Do not use `pnpm dev` as a readiness check: it starts live workers and the local API immediately.
7. For launch, explicitly load this private file into child environments; the existing worker entry points do not auto-load it. Use a foreground, supervised run of all four compiled worker entry points, with shutdown and logs reviewed before a longer run. No auto-start service or scheduled task is installed by this preparation.

Keep Windows awake and online during an approved run. Once workers stop, health indicators will expire. The ingestion heartbeat represents successful polls; a long test polling interval can cause temporary unhealthy status between polls. Do not weaken production monitoring merely to make a test green.

## Supervised test result — 2026-09-08

- Supabase schema/migration checks and the approved database bootstrap are recorded in `SUPABASE_BOOTSTRAP.md`. Only API-Football competition 39 (Premier League), season 2026, was enabled for this test.
- `scripts/workers-smoke-test.mjs --run` started the four existing compiled worker entry points with verified PostgreSQL TLS and encrypted Aiven Redis. The event processor, content generator and outbox dispatcher reported readiness; ingestion completed one successful poll.
- The first run made exactly four provider requests, each returning HTTP 200. The last response reported 74,567 daily requests remaining. That balance is shared with other usage, not solely this test.
- Supabase contains one successful polling record, started at `2026-09-08 10:19:37.069` UTC and finished at `10:19:41.469` UTC. It retrieved zero eligible fixtures from the live/yesterday/today/tomorrow discovery window. Fixture, event, content-item and pending-outbox counts remained zero.
- The supervisor initially reported `POLL_TIMEOUT`: its local Date parameter was interpreted as a timezone-less Nairobi timestamp when compared with a UTC database column. A subsequent **read-only** query verified the successful saved result and demonstrated the three-hour binding difference. The supervisor now identifies a new poll by its record ID instead. That correction has not been rerun against the live provider.
- All four child processes exited with code 0. The ingestion lock was released. Heartbeats can remain briefly until their TTL expires; they do not mean the test processes are still running.
- No fake jobs, fixtures, events or content were inserted. No existing data was deleted, and no Vercel configuration, GitHub deployment, scheduled task or persistent service was changed.

## Test commands and boundaries

Use Node.js 24 from the repository root:

```text
node scripts/workers-smoke-test.mjs --self-test
node scripts/workers-smoke-test.mjs --verify
node scripts/workers-smoke-test.mjs --run
```

`--self-test` checks the request cap, endpoint origin, worker restriction and refusal to follow redirects offline. `--verify` reads remote aggregate counts, saved polling results and heartbeat/lock state, without launching workers or calling API-Football. `--run` is a **live write operation** requiring approval: it refuses existing pending/queued work or worker heartbeats, caps provider requests at 12, allows a 90-second monitoring window, and shuts down its own child processes. Independent child and supervisor deadlines guard against orphaned processes. It uses this computer's public Supabase CA certificate path and exact project guards; do not use it unchanged for another project.

## Still unverified

Actual fixture-to-event-to-content processing was **not exercised**, because no eligible Premier League matches were returned. Queue connectivity/readiness is not proof that a real job has completed. Next, choose a real match for a separately approved, bounded end-to-end test (historical replay must be clearly separated from live publication). Worker throughput, long-running reliability, email delivery, and the Vercel-to-new-Redis connection remain unverified. Nothing is running continuously.
