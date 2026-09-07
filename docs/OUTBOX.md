# Durable work delivery

PostgreSQL `work_outbox` is the authoritative record of pending work. Redis
queues are retryable delivery notifications, not proof that processing finished.

## Transaction boundaries

1. A meaningful fixture change saves its snapshot and fixture-processing work
   in the same transaction. No queue call happens in that transaction.
2. The outbox dispatcher claims due rows using a conditional update, then adds
   queue jobs with the stable outbox UUID as job ID.
3. The event processor persists its prepared event drafts before inserting any
   canonical events. Retrying a partially processed observation reuses that
   checkpoint, including correction links, instead of fetching upstream again.
4. Each canonical event and its content-generation work commit together.
   Duplicate events still ensure a durable content handoff exists.
5. Content insertion and work completion commit in one transaction. Concurrent
   consumers serialize on the outbox row; a failed insert rolls completion back.

Enqueue success does not complete a row. Unfinished work becomes eligible again
with exponential retry spacing capped at 60 seconds. BullMQ jobs have five local
attempts and are removed on success/final failure; PostgreSQL retains unfinished
work and can recreate a lost or exhausted queue job. This is at-least-once
delivery with idempotent consumers, not an exactly-once transport guarantee.

Malformed dispatch payloads are paused with `INVALID_OUTBOX_PAYLOAD`. Consumer
failures remain pending with `WORKER_PROCESSING_FAILED`; detailed failures are
in worker logs. Fix the underlying problem before retrying a paused record.
Pending work is not discarded merely because a retry limit was reached.

The dispatcher uses bounded queue waits. A timed-out queue operation can still
finish later; stable IDs and consumer completion checks make that safe.

## Rollout

The new migration is `20260907000000_durable_outbox`. Stop the old ingestion,
event, and content workers first so they cannot create untracked work during
the migration. Apply it to the intended database, then start all updated
workers together; do not run mixed old/new worker versions:

```text
pnpm db:migrate
pnpm build
pnpm dev
```

`pnpm dev` and Docker Compose now include `@fcp/outbox-dispatcher`. Migration
execution is not automatic on application startup. Existing Docker connection
configuration and clean-machine deployment still require the planned deployment
hardening; this change does not certify Docker startup.

The migration creates content work for existing canonical events that have no
content. Existing legacy queue messages are adopted into the outbox when they
are processed. Historical fixture snapshots are **not** automatically replayed:
their original upstream event responses may no longer be available.

Configuration defaults:

- `OUTBOX_POLL_INTERVAL_MS=1000`
- `OUTBOX_BATCH_SIZE=50`

`/v1/health` includes the dispatcher's heartbeat as `outbox_worker`. A heartbeat
is not a backlog or publication-latency SLO; those operational alerts remain to
be added. Completed records and checkpoints are retained; retention policy is
also a later operational task.

## Operator recovery

Commands use the configured `DATABASE_URL`; confirm the target environment.

```text
pnpm outbox:recover status
pnpm outbox:recover pause <outbox-uuid>
pnpm outbox:recover retry <outbox-uuid>
pnpm outbox:recover reconcile
pnpm outbox:recover fixture <current-state-uuid> <previous-state-uuid>
```

- `status` lists up to 50 oldest unfinished records without dumping payloads.
- `pause` prevents future consumption/dispatch of that pending record. It does
  not cancel a consumer already executing.
- `retry` resumes pending work. It does not reset completed work or erase its
  event checkpoint.
- `reconcile` explicitly schedules events missing all content, including
  resetting a stale completed/paused marker for those events. It does not
  regenerate content that already exists.
- `fixture` adopts/reschedules an explicitly selected snapshot pair. Verify
  those are the intended adjacent observations. The snapshots must be ordered
  and belong to the same fixture. Already completed work is not reprocessed.
  Historical source interpretation needs operator review until the event
  identity/lifecycle remediation is complete.

## Verification limits

Unit tests cover dispatch failures, redelivery, conditional claims, checkpoints,
duplicate-event handoff repair, and completion boundaries. An isolated database
integration test injects CHECK-constraint failures at each handoff to verify
rollback, then exercises retry and concurrent content consumers. Its queue
transport is simulated; it is not a full independent-worker/Redis failure test.
Run it through `pnpm test:integration` after the setup in `docs/TESTING.md`.

Event taxonomy, source fingerprint stability, match lifecycle reconciliation,
per-fixture ordering, and commit-ordered feed cursors remain separate audit
items. Durable delivery does not by itself correct those domain behaviors.
