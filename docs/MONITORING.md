# Monitoring: worker liveness and backlog checks

`GET /v1/health` is public, uncached, and checks PostgreSQL, Redis, the
ingestion poll heartbeat, outbox dispatch heartbeat, event processor, and content
generator. Missing workers or unavailable stores return HTTP 503. Provider
failure/unknown status alone retains the existing `degraded` response with HTTP
200: monitors must inspect the JSON status, not just the HTTP code.

Event/content workers now refresh liveness immediately after readiness and every
third of `WORKER_HEARTBEAT_TTL_SECONDS`, even without incoming jobs. Heartbeats
use a separate bounded Redis client, do not overlap, and log failed writes.
Shutdown stops refreshes; the last key expires naturally. A replica shutting down
must not delete the shared key belonging to another healthy replica.

Deploy the updated workers before relying on the stricter API health check. Old
workers only write after a job and will incorrectly appear unavailable while idle.
Ingestion and dispatcher heartbeats still indicate successful poll/dispatch loops,
not merely a running process. A poll exceeding the TTL can appear unhealthy.

## Limits and next steps

A worker heartbeat proves a recently responsive process, not successful delivery.
A blocked job, paused queue, or broken consumer connection can coexist with a
fresh heartbeat. Keys represent at least one replica, not every replica. Redis
key loss can cause transient unhealthy responses; namespace every environment.

No external alerts, scheduled checks, dashboard, or log drain are configured by
this checkpoint. Existing structured logs remain the diagnostic source. The
backlog command below evaluates thresholds on demand. Next is an independent
monitor with an explicitly selected notification destination. It must alert on
its own missing checks as well as application failures.

Do not use this full-pipeline endpoint as a process restart probe: another
service's failure should not repeatedly restart a healthy API. Vercel deployment
success is not proof that external workers are deployed or running.

## Operator backlog check

Build the workspace, then run `pnpm --silent monitor:check` on a trusted operator
host with the intended `DATABASE_URL`. It uses the same schema-aware connection
as the application, but needs no Redis connection or provider credentials.
This is a CLI, not a public HTTP endpoint. Prefer a dedicated SELECT-only database
role with schema USAGE and access to work_outbox, source_event_reviews,
competitions, and polling_runs; do not distribute application database credentials.
The command additionally enforces a read-only repeatable-read transaction.

The single JSON report contains version, database observation time, thresholds,
counts/ages, and alert codes. It includes no job payload, review evidence, API key,
database URL, or driver exception. Startup banners from pnpm are suppressed with
`--silent`; capture stdout and stderr and use the process exit code.

| Condition                                       | Default      | Severity |
| ----------------------------------------------- | ------------ | -------- |
| Oldest active uncompleted work age              | 300 seconds  | critical |
| Any paused uncompleted work                     | immediate    | warning  |
| Oldest pending source review age                | 3600 seconds | warning  |
| Last successful API-Football poll age (or none) | 180 seconds  | critical |

Thresholds are inclusive and overrideable with explicit flags, for example:
`pnpm --silent monitor:check --outboxSeconds=600 --reviewSeconds=7200 --providerSeconds=300`.
Unknown, duplicate, zero, negative, and excessively large values fail validation.
Tune these starting thresholds against actual poll duration and editorial coverage;
they are not established service-level objectives.

Exit codes: 0 = no threshold violations; 1 = warnings; 2 = critical;
3 = unknown/check failure (including timeout/configuration failure). Alert on 3
and on absence of a fresh report, never interpret them as healthy. SQL statements
have a 5-second deadline, the snapshot transaction 10 seconds, and the CLI a
20-second hard deadline including connection/cleanup. This may terminate an
unresponsive local client process; it never retries or alters application work.

Delivery age is measured from creation until completion, even during retry backoff
or a future available_at time. Queue acceptance is not delivery. Paused rows are
reported separately and require operator review, not automatic unpausing. Completed
rows and resolved source reviews are excluded. Provider freshness is expected only
when API-Football competitions are enabled. Successful empty polls count as success;
no published content during quiet periods is not itself an incident. This is poll
health, not proof that every fixture was reconciled or every provider request worked.

Use alongside worker health: this command does not check Redis or process liveness.
The snapshot is database-wide within the selected schema, not scoped by QUEUE_PREFIX.
Existing work/review indexes support filtering; polling success aggregation may scan
historical runs. Before scheduling frequently on a large production database, inspect
EXPLAIN plans and size a provider/status/finished_at index or retention policy. Query
timeouts fail visibly instead of allowing an unbounded scan. No schema migration,
production check, scheduler installation, or external notification was performed.
