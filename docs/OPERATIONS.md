# Operations

Run PostgreSQL and Redis with durable volumes, apply migrations before application rollout, then start the API and three workers. Health reports database, Redis, cached provider state, and ingestion heartbeat without infrastructure details.

Structured logs carry request, fixture, event, content, worker, provider, and client identifiers where applicable. Polling runs persist duration, result counts, and safe error codes. In-memory metric names cover poll success/failure/duration, provider latency, detected/duplicate events, generated content, API latency/errors, and worker failures; these are extension points for Prometheus/OpenTelemetry.

BullMQ retries jobs five times with exponential backoff. Inspect failed jobs, polling runs, and system incidents before replaying. Event/content uniqueness makes normal replay safe.
