# Audit remediation sequence

Work is applied in independently verified stages. Completing one stage does not
mean the platform is production-ready.

1. Runtime packaging and queue job IDs (implemented; local smoke checks pass).
2. Isolated integration-test resources (implemented; GitHub CI real-store run passed).
3. Provider-to-internal player/team identity mapping (implemented).
4. Durable database-to-queue delivery and replay/reconciliation (implemented; GitHub CI database rollback scenarios passed; real worker crash testing pending).
5. Event observations, lifecycle reconciliation, and explicit review of ambiguous source identities (implemented; linked editorial corrections remain separate work).
6. Commit-ordered feed publication and cursor recovery.
7. Failure-injection acceptance tests, security, deployment, and monitoring.

## Stage 1 changes

- Workspace packages expose compiled JavaScript and declaration files.
- API/worker builds retain workspace imports instead of inlining native and
  transitive dependencies into ESM bundles.
- Database declares its shared-package dependency explicitly.
- Fixture-change queue IDs use a deterministic, delimiter-safe hash of the
  fixture and observation IDs. This is queue identity, not event identity.
- `pnpm verify:runtime` verifies compiled database imports, native Argon2
  hash/verification, and all four service entry points. It deliberately removes
  required configuration so services exit before contacting external systems.
- CI runs the runtime smoke check after building on Node 24.

Run `pnpm build`, then `pnpm verify:runtime`. Development TypeScript continues
to resolve source through the repository's path aliases; production uses dist.
Build before consuming a workspace package from plain Node.js.

The smoke check is not an integration or healthy-service test. It does not
verify database connectivity, Redis delivery, migrations, or Docker startup.
The transactional delivery gaps from the audit remain until stage 4.

Local verification: 22 unit tests pass across 8 files; build, typecheck,
lint, and all runtime smoke checks pass. The local runtime is Node
22.16.0. Node 24 CI and Docker execution still need deployment-environment
verification; adding a CI check does not mean CI has already run.

## Stage 2 changes

- Test-only URLs are validated before client construction; no application URL
  fallback is allowed.
- A fresh schema and Redis key namespace isolate each integration run.
- Cleanup deletes only owned resources, including after partial setup failure.
- Explicit integration invocation cannot silently skip configuration checks.
- CI supplies dedicated test settings; each suite applies its own migrations.
- Test naming now distinguishes repository/API integration from queue-worker E2E.

42 unit tests pass, including 20 isolation/lifecycle tests. Lint and typecheck
pass. The explicit integration command was verified to fail before connecting
when test settings are absent; the default test command passes 42 and skips
the one real-store test. PostgreSQL/Redis were not running locally and Docker
was unavailable, so real migration/cleanup behavior still needs a configured
integration run. See `docs/TESTING.md`.

## Stage 3 changes

- Provider events use a separate `NormalizedSourceEvent` contract with source,
  sourceFixtureId, sourceTeamId, and sourcePlayerId. Those fields are not
  canonical database foreign keys.
- The event worker checks fixture/provider ownership, maps only that fixture's
  two teams, and upserts players through the existing unique `(source, sourceId)`
  key before passing resolved events to the detector.
- Unknown source teams produce a logged identity issue and no team foreign key.
  Player names without source IDs are retained as event text, not used to guess
  a player record. Nameless identified players retain a UUID; their database
  placeholder is never inserted into event text or used to overwrite known names.
- Historical event attribution does not update a player's current roster.
- A canonical persistence guard rejects malformed internal UUIDs before any
  database call. No database schema migration is needed for this stage.
- Regression coverage includes both teams, missing data, cross-provider/fixture
  rejection, concurrent-upsert conflict recovery, and persistence validation.
- The isolated integration scenario now resolves a provider player twice and
  verifies one player row and real event/player/team foreign-key relationships.
  This real-store scenario remains pending local PostgreSQL/Redis availability.

This fixes identity persistence, not the outstanding source-event fingerprint,
event taxonomy, match lifecycle, or durable queue-delivery issues.

Stage 3 local verification: 65 unit tests pass across 11 files (23 new tests).
Lint, typecheck, build, formatting checks on touched files, and compiled runtime
smoke checks pass. No migration or live database mutation was performed.

## Stage 4 changes

- Added `work_outbox` and a migration backfilling events missing content.
- Fixture snapshots and their work commit together; events and content work
  also commit together. Queue I/O runs outside those transactions.
- Added an independent dispatcher with stable job IDs, conditional claims,
  bounded retry spacing, invalid-payload quarantine, and pending-work redelivery.
- Event drafts are checkpointed before canonical inserts; duplicate event
  processing still repairs a missing content handoff.
- Content persistence and consumer completion are one transaction with a
  concurrency guard. Lost acknowledgements do not repeat completed work.
- Added operator status/pause/retry/reconcile and explicit fixture recovery.
- Added dispatcher startup to development/Compose and runtime smoke checks,
  plus an API health heartbeat. See `docs/OUTBOX.md` for rollout and limitations.

No migration has been applied to a live database during this stage. Database
rollback integration tests and actual Redis/worker failure tests still require
an isolated running environment; unit tests are not a substitute for them.

Stage 4 local verification: 91 unit tests pass across 14 files (26 new tests).
Default test execution passes 91 and skips the two real-store scenarios.
Lint, typecheck, Prisma schema validation, build, and compiled runtime smoke
checks pass, including the new dispatcher. The migration is written and the
client regenerated, but the migration has not been applied here.

## Stage 5 changes

- The stage 1–4 checkpoint passed GitHub CI on Node 24, PostgreSQL 17, and Redis 8.
  Its two integration scenarios passed; these are direct consumer/repository
  tests, not independent worker-process crash tests.
- Source events are persisted with fixture observations and consumed without
  refetching later provider state. Event-only and late arrivals are detected.
- Source IDs no longer include array position; v2 fingerprints ignore mutable
  score/name enrichment. Exact legacy source IDs remain recognizable.
- Score-only changes emit aggregate updates/corrections, not fabricated goals.
  Historical content no longer falls back to the fixture's latest score.
- Added UTC schedule discovery, tracked-fixture reconciliation, fail-closed
  competition configuration, serial polling, renewable ownership, and database
  stale-write protection. HTTP-200 provider errors cannot masquerade as no data.
- Added a source-observation migration and regression tests covering these paths.

See `INGESTION.md` and `EVENT_MODEL.md` for rollout and limitations. Stage 5 is
not claimed fully closed: changing source identity fields and indistinguishable
events still need a revision/ambiguity policy. Commit-ordered publication and
full transport failure injection remain subsequent work.

Stage 5 local verification: 119 unit tests pass across 16 files. Lint,
typecheck, Prisma schema validation, build, and the native dependency/five-service
runtime smoke checks pass. [GitHub CI for implementation commit cc1003f](https://github.com/jonnieke/football/actions/runs/34155464137)
passed all 122 tests across 19 files, including all three isolated integration
scenarios, and its build/runtime checks. The observation migration was exercised
only in isolated CI schemas; no application database migration was executed.

## Stage 5 follow-up: ambiguity reviews and process recovery

- Added durable source-event reviews for duplicate keys, possible replacements,
  and legacy baselines. The first post-upgrade poll scans retained history.
- Pending/dismissed keys are gated during observation preparation and again
  during canonical persistence, including already checkpointed work.
- Operator publish-one/dismiss decisions retain immutable evidence, operator,
  reason, and timestamp. Publication and its content handoff share the decision
  transaction; conflicting final decisions cannot overwrite each other.
- Added schema-aware standalone database clients and configurable queue/health
  namespaces while preserving current production defaults.
- Added a separate compiled-worker test: actual dispatcher/event/content Node
  processes, real BullMQ/Redis, PostgreSQL publication lock, forced content-worker
  death, replacement, and duplicate/loss checks. CI runs it after building.

Local verification: 141 unit tests pass across 19 files; lint, typecheck and
schema validation pass. Database integration and process recovery run in CI,
not against application stores. See `SOURCE_REVIEWS.md` and `TESTING.md` for the
decision policy, test boundaries, cleanup, and rollout requirements. No
application database migration or operator review decision was executed here.

## Stage 6: commit-ordered feed and cursor recovery

- Database-triggered, transactionally locked publication positions prevent late
  commits from falling behind a partner's cursor. Rollback releases the reservation.
- Published content and filter identity are frozen; event-type routing is captured
  at publication. Timestamps remain display metadata only.
- Signed v2 cursors bind filters and feed epoch, preserve bigint precision, and
  advance safely on empty polls. Old timestamp cursors explicitly require reset.
- Added an audited operator epoch-reset command for database restore procedures.
- Added real-database concurrency/rollback tests and cursor/API regression coverage.

See [FEED_PUBLICATION.md](FEED_PUBLICATION.md) for the coordinated migration rollout,
client replay contract, primary-database requirement, and mandatory restore reset.
Local unit verification: 154 tests. No production migration or epoch reset has run.
Historical-data upgrade rehearsal, correction/withdrawal workflows, retention, and
broader transport failure injection remain outstanding.
