# Monitoring checkpoint: worker liveness

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
this checkpoint. Existing structured logs remain the diagnostic source. Next:
an operator-only backlog report (oldest uncompleted outbox work, paused work,
source reviews, provider success age), followed by threshold evaluation and an
independent monitor with an explicitly selected notification destination. The
monitor must alert on its own missing checks as well as application failures.

Do not use this full-pipeline endpoint as a process restart probe: another
service's failure should not repeatedly restart a healthy API. Vercel deployment
success is not proof that external workers are deployed or running.
