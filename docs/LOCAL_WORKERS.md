# Local worker testing on Windows

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
