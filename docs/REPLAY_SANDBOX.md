# TEST ONLY — isolated match replay preparation

## Status

**Draft-first update:** The local generator now creates drafts, and the combined
worker test has been rerun with assertions that all generated items have null
publication metadata. See `CONTENT_APPROVAL.md` for approval and rollout rules.
Earlier dated results below describe the pre-approval implementation. Existing
saved HTML reports are retained as historical artifacts, not current behavior.

Verified on 2026-09-14: Docker Desktop's local PostgreSQL and Redis containers
started healthy, with ports bound only to loopback. All 14 integration tests
across 8 suites passed against these isolated stores (127.35 seconds).
The first parallel run timed out during migration setup; the sandbox runner
now limits execution to one test worker, and the sequential rerun passed.
Docker's disk image location is on D:.

Stage 2 verified on 2026-09-14: captured one full-time Premier League match
(provider fixture 1557404, Manchester United 0–1 Manchester City) using exactly
three provider GETs. Replayed the saved final snapshot through the actual
database/event/content code: 2 supported source events, 3 canonical events,
3 content items, zero held reviews and zero pending work. Duplicate input and
repeated delivery left event/content/work/state counts unchanged. The owned
test schema was cleaned before the local HTML/JSON report was exported.

This is a **final-snapshot replay**, not a captured sequence of live polls.
No intermediate scores or kickoff/half-time observations are fabricated. Goal
and card alerts therefore omit unavailable in-event scores. Queue processes,
continuous live polling, live API delivery and email delivery remain unverified
by this replay. Never point the live dashboard at the test database.

The preview is script-free, escaped HTML with a restrictive CSP, no remote
assets and explicit TEST ONLY labelling. Desktop/mobile browser verification
found 3 content cards, no page errors, no external requests or mobile overflow.

Stage 3 verified on 2026-09-14: `pnpm sandbox:workers` rebuilt the compiled
runtime dependencies and three workers, then passed both real-process tests
through local BullMQ/Redis and PostgreSQL (148.78 seconds overall):

- Idle event/content worker heartbeats refreshed, then expired after process death.
- A content worker was killed while blocked inside its publication transaction.
  Its writes rolled back; the replacement recovered after queue lock expiry and
  completed exactly 3 distinct content items, with zero pending outbox work and
  zero failed content jobs.

These tests use synthetic fixtures and actual child processes for the outbox
dispatcher, event processor and content generator. They do not start the
football-ingestion worker, make provider requests or send emails. They are
separate from the completed-match snapshot replay above. Passing this test does
not establish continuous hosting or live API/email delivery. Test-owned children,
queues, health keys and schema are cleaned on completion.

Stage 4 verified on 2026-09-14: `pnpm sandbox:collector` passed the compiled
football-ingestion process test (35.85 seconds overall). A local HTTP server
bound to 127.0.0.1 on an ephemeral port supplied synthetic provider responses.
No real API key was supplied. The test verified:

- Only the enabled competition was imported, despite another league in the response.
- Source goal observations were stored and unchanged polls created no extra state/work.
- A match disappearing from the live response was reconciled by fixture ID to FT.
- An HTTP-200 provider error envelope failed the poll without corrupting saved state,
  marked provider health unhealthy and released the polling lease.
- The collector recovered on the next healthy response and restored health signals.

The test permits at most 80 local mock requests, uses bounded waits, then closes
its own collector process/mock server and removes its owned schema and exact
Redis lease/health keys. The local services were stopped afterward. This is
collector-only process coverage; it does not claim all four workers ran together
in one end-to-end scenario or verify real-provider continuous polling.

Stage 5 verified on 2026-09-14: `pnpm sandbox:pipeline` passed the combined
four-worker test (94.93 seconds overall). All four compiled workers ran together
against the same randomly isolated PostgreSQL schema and BullMQ queue prefix.
The collector read only the loopback simulated provider; downstream workers
processed real queue deliveries without direct test calls to event/content
consumer functions. Assertions verified:

- Exactly 3 distinct content items: match_started, goal and match_finished.
- The goal contained Test Scorer and the full-time result contained Test Home 1-0 Test Away.
- All four worker heartbeat keys were present.
- The simulated provider-error/recovery sequence preserved the pipeline's data.
- Another successful poll after completion left exactly 3 events/content items,
  zero incomplete outbox work and zero failed fixture/content queue jobs.

The test closed all owned worker processes and the mock server, removed only
its owned queues/health keys/schema, and the local services were stopped.
No real provider requests, emails, live database writes or deployments occurred.
This establishes local worker-pipeline behavior, not production readiness:
continuous hosting, real-provider operation, live API delivery and alert/email
delivery still need their own launch checks.

## Boundaries

- Separate Docker project `football-replay-sandbox`, PostgreSQL database
  `football_replay_test`, and Redis database 1 on dedicated ports 15432/16379.
- Both ports bind only to 127.0.0.1. The local-only database password is a
  development credential, not a production secret. Do not expose these services
  to a LAN/public interface or use these credentials on hosted services.
- No API, admin dashboard, polling service, or workers in the Compose file.
- No application `.env` file mounted or loaded. The runner removes inherited
  live credentials and substitutes fixed test endpoints, including for Prisma.
- Each integration suite owns a random test schema and Redis namespace;
  teardown removes only that suite's resources. The local test volumes persist.
- Content may be marked `published` **inside the isolated database** to exercise
  actual production code. That does not publish it to the live API.
- No provider or email keys are supplied to replay. This is a trusted-code test harness,
  not a security sandbox for malicious code. The separately bounded importer
  selects one completed Premier League match and captures it; the replay
  itself must run from the captured data without provider/email credentials.
- This setup does not verify continuous hosting or real inbox delivery.

## Once Docker Desktop is installed and running

Use the local Docker Desktop engine, not a remote Docker context. From the
repository root, after approval to start the local infrastructure:

```powershell
docker --context desktop-linux compose -p football-replay-sandbox -f docker-compose.sandbox.yml config
docker --context desktop-linux compose -p football-replay-sandbox -f docker-compose.sandbox.yml up -d --wait
```

Do not run the root `docker-compose.yml`: it includes live-style application
services and loads `.env`. Do not merge the two Compose files.

With Node 24 available:

```powershell
pnpm sandbox:check
pnpm sandbox:test
pnpm sandbox:workers
pnpm sandbox:collector
pnpm sandbox:pipeline
```

`sandbox:check` is offline configuration validation, not a readiness probe.
`sandbox:test` runs existing integration tests against only the fixed local stores.
It creates/migrates/cleans test-owned schemas; it does not start queue workers or
fetch any match. A failure must not be bypassed by changing URLs to Supabase/Aiven.

`sandbox:workers` uses the same sanitized environment and fixed local endpoints.
It builds runtime JavaScript from source (without dependency installation), then
runs the worker suite with one test runner. It intentionally kills only its own
spawned worker processes to exercise recovery. Allow several minutes for real
queue-lock expiry. Do not substitute the unsanitized `test:workers` command or
the live `workers-smoke-test.mjs` script when following this sandbox workflow.
It now includes the collector test as well as the crash-recovery suite.
`sandbox:collector` rebuilds runtime artifacts and runs only the collector test
against its local mock provider. Neither command consumes a real provider quota.
`sandbox:pipeline` enables the four-worker assertions in that same scenario;
it retains the fixed local endpoints and sanitized environment. The collector
and ordinary worker test commands do not implicitly enable this combined mode.

Stop the sandbox when finished (preserves its data):

```powershell
docker --context desktop-linux compose -p football-replay-sandbox -f docker-compose.sandbox.yml stop
```

Do not use `down -v` or a prune command for routine shutdown. Never delete an
existing volume or schema without identifying ownership and obtaining approval.

Official installation instructions:
https://docs.docker.com/desktop/setup/install/windows-install/

## Capturing and replaying one completed match

Only the capture command uses the API key from `.env.workers.local`. It does not
install that file into the process environment or create any database clients.
It permits at most 3 requests, with 20-second request deadlines, a 2 MB response
limit, no retries and no redirects, to the fixed API-Sports host. HTTP/error
envelopes, non-FT matches, other leagues and invalid data fail closed.

```powershell
pnpm sandbox:capture
# Copy the returned filename, not a full path:
pnpm sandbox:replay <capture-filename.json>
```

Start only the two local sandbox containers before replay. The replay command
relaunches itself with the sandbox environment allowlist, validates fixed local
endpoints and uses a randomly owned test schema. It calls the actual consumers
directly, not queue workers. No provider calls occur during replay. Reuse the
capture filename to rerun without consuming more provider requests.

Captures and reports live under `.sandbox-replay/`, excluded from Git and Vercel.
Each export uses a new directory and exclusive file creation. The preview can
be opened directly as a local HTML file; it needs no server or sign-in.
Content generated in the temporary database uses production code's `published`
status but is never available through the production API. Routine cleanup
removes only the random schema/keys created by that run; captures and reports
are retained. Stop the sandbox services when finished using the command above.

Provider reference:
https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide
