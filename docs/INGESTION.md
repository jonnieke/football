# Ingestion

Polling requires explicitly enabled `api-football` competitions. An empty set
fails closed instead of importing all live competitions. Seed/configure the
intended league IDs and seasons before starting ingestion.

The serial poll loop retrieves live fixtures, discovers yesterday/today/tomorrow
in UTC every `SCHEDULE_POLL_INTERVAL_SECONDS` (default 900), and reconciles
tracked fixtures missing from those responses by ID. Discovery uses the
[provider's documented date filter](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide).
Missing fixtures are never assumed finished. Reconciliation includes unfinished
fixtures plus terminal fixtures with kickoff in the past three days. It is
bounded by `RECONCILE_BATCH_SIZE` (default 100), oldest-polled first. Older
terminal corrections and outages beyond the discovery window need operator
backfill; suspended/postponed fixtures remain eligible.

Non-pregame fixtures fetch events every observation, even with unchanged scores.
Provider errors, including HTTP-200 error envelopes, fail the poll rather than
becoming empty event lists. Played fixtures with missing scores are rejected.
Capture uses request-start time as the ordering watermark, not a claimed
upstream modification time. Fixtures and event lists are separate upstream
requests, not an atomic provider snapshot; no per-event score is inferred.

Each observation stores its normalized source events with the fixture snapshot
and durable outbox handoff in a short PostgreSQL transaction. Source event or
status/score changes enqueue work. Minute-only changes can create snapshots but
do not enqueue work. Identical/reordered observations do not republish events.
Transaction-scoped advisory locks serialize same-fixture writers; stale or
equal request timestamps cannot overwrite newer state. Provider I/O stays
outside database transactions.

A random-token Redis lease renews while polling and releases via atomic
compare/delete. Lost ownership prevents subsequent writes; database ordering
is the final guard against delayed writers. The loop awaits each poll and drains
active work on shutdown. Do not confuse the live poll interval with an end-to-end
latency guarantee: large batches and retries increase cycle duration.

## Stage 5 rollout

1. Stop old ingestion; let old event/content workers drain pending work.
2. Stop remaining workers. Back up the intended database.
3. Apply migrations, including `20260908000000_fixture_observations`, and build.
4. Restart all workers from the same version; verify configured competitions,
   pending outbox work, polling failures, and provider quota.

Legacy snapshots retain NULL source observations. Unprepared legacy work fails
closed rather than fetching current facts for an old snapshot; explicitly pause
and investigate it. Existing checkpointed work can finish without preparation.
Never manufacture or overwrite historical observation data to clear a backlog.

## Still outstanding

- Provider quota budgeting, per-fixture failure isolation, coverage-aware calls,
  and a slower dedicated cadence for terminal/postponed fixtures.
- Source revisions that change identity fields, ambiguous duplicate occurrences,
  and reliable links from cancellations to the exact original event.
- Independently running worker/Redis crash and lease-expiry acceptance tests.
- Feed publication ordering, retention, operational SLOs, and deployment hardening.
