# Architecture

Football Content Platform is an independent B2B football-content infrastructure product. It polls a structured upstream provider, records normalized fixture state, derives canonical events, generates deterministic publication-ready content, and exposes that content through a secure partner API. Distribution partners—including a future Safaricom 411 integration—consume this API. Subscriber management, billing, SMS, USSD, MSISDNs, and partner infrastructure are outside this system.

## Runtime shape

```text
API-Football -> ingestion worker -> fixture state -> event queue
                                              -> event processor -> event ledger -> content queue
                                                                                -> content generator
Partner -> Fastify /v1 API -> PostgreSQL/Redis read models
```

- PostgreSQL is authoritative for fixtures, immutable state snapshots, events, content, clients, request logs, polling runs, and incidents.
- Redis provides BullMQ queues, locks, hot fixture state, rate limits, worker heartbeats, and short-term deduplication.
- Partner requests never trigger upstream calls.
- Provider payloads are validated and normalized inside `packages/football-provider`.
- Pure functions in `packages/football-core` compare state, classify transitions, and fingerprint events.
- `packages/content-core` renders deterministic templates and applies length-preserving fallbacks.

## Repository tree

```text
football-content-platform/
  apps/api/                  Fastify partner API
  apps/admin/                Phase 1 health placeholder
  workers/football-ingestion/
  workers/event-processor/
  workers/content-generator/
  packages/database/
  packages/football-core/
  packages/football-provider/
  packages/content-core/
  packages/shared/
  tests/integration/
  docs/
  scripts/
  docker/
  .github/workflows/
```

## Boundaries and consistency

Dependencies flow inward: applications and workers depend on packages; football core has no infrastructure dependency. Database code stores domain values but does not decide football meaning. Provider code maps external vocabulary into controlled internal types. Routes validate transport input and delegate.

Every fixture change produces an append-only `fixture_states` snapshot. Meaningful changes produce canonical ledger rows. A SHA-256 fingerprint over stable semantic fields and a database unique constraint provide durable idempotency; Redis only accelerates duplicate rejection. Reversals append `goal_cancelled` or `score_correction` events and may reference the superseded event.

The platform uses UUIDv7: it is time-sortable, standardized, and UUID-compatible. Feed cursors use a database-assigned, commit-ordered publication position, not timestamps or UUID ordering. See [feed publication](FEED_PUBLICATION.md).

Synthetic fixtures will be supplied by a separate `FootballProvider` implementation in an isolated sandbox environment, preserving the same normalized domain and `/v1` schema without contaminating production data.
