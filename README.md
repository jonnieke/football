# Football Content Platform

A production-oriented Phase 1 B2B platform that polls API-Football, normalizes fixtures, detects meaningful match transitions, keeps an append-only event ledger, generates deterministic publication-ready content, and serves it through an authenticated partner API.

This is an independent football product. It does **not** send SMS, bill users, manage subscribers/MSISDNs, expose USSD, scrape websites, or integrate with Safaricom infrastructure. Safaricom 411 is one possible future consumer of the partner API; the football core is partner-independent.

## Architecture

Work handoffs now use a PostgreSQL transactional outbox and an independent
dispatcher. Apply the new migration before starting updated workers. See
[durable delivery and recovery](docs/OUTBOX.md) for rollout requirements.

Stage 5 also captures source events in fixture snapshots. Read the
[ingestion upgrade procedure](docs/INGESTION.md#stage-5-rollout) before changing
running workers: drain legacy work and apply the observation migration first.
The [event contract](docs/EVENT_MODEL.md) now includes `score_updated` and
does not invent event-time scores for historical source events.
Ambiguous source revisions are held for [operator review](docs/SOURCE_REVIEWS.md).

```text
API-Football -> ingestion -> fixture snapshots -> event processor
                                            -> immutable event ledger
                                            -> content generator
Partner -> Fastify /v1 API -> PostgreSQL + Redis read/coordination layer
```

PostgreSQL is the durable source of truth. Redis coordinates queues, locks, worker heartbeats, short-lived deduplication, and per-client rate limits. Incoming partner requests never call API-Football. See [Architecture](docs/ARCHITECTURE.md).

## Requirements

- Node.js 24+
- pnpm 10+
- Docker with Compose
- API-Football key for real ingestion

## Local setup

```bash
cp .env.example .env
# Set API_FOOTBALL_KEY and a random CURSOR_SIGNING_SECRET (32+ characters)
pnpm install
docker compose up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm api-key:create --name "Local partner" --slug local-partner
pnpm dev
```

To run the complete containerized stack:

```bash
docker compose up --build
```

## Commands

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm api-key:create --name "Partner" --slug partner --rate-limit 120
pnpm api-key:revoke --slug partner
```

Integration tests require explicit `TEST_DATABASE_URL` and `TEST_REDIS_URL` and
use an isolated schema and Redis key namespace. `pnpm test:integration` enables
them explicitly; ordinary `pnpm test` skips them unless `RUN_INTEGRATION_TESTS=true`.
See [safe test setup](docs/TESTING.md) before running integration tests.

## Partner API

Send `Authorization: Bearer <partner-api-key>` except for health and documentation.

```bash
curl -H "Authorization: Bearer $PARTNER_KEY" \
  "http://localhost:3000/v1/feed?channel=epl&event_type=goal&limit=100"
```

Endpoints:

- `GET /v1/health`
- `GET /v1/competitions`
- `GET /v1/fixtures/live`
- `GET /v1/fixtures/:id`
- `GET /v1/events`
- `GET /v1/events/:id`
- `GET /v1/feed?after=&limit=&channel=&event_type=`
- `GET /docs` for OpenAPI UI

Every response carries `X-Request-ID`. Errors use a stable `error.code`, safe message, and request ID. Feed cursors are opaque, signed, filter-bound, and ordered by database-assigned commit-ordered publication positions. Empty polls preserve a usable cursor; legacy cursors and restored histories require explicit recovery.

## Environment

See [.env.example](.env.example). Credentials are environment-only and must never be committed. Key controls include upstream timeout/retries, poll interval, content length, API rate limit, heartbeat TTL, and cursor signing secret.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Vercel API deployment](docs/VERCEL.md)
- [Database model](docs/DATABASE_MODEL.md)
- [API](docs/API.md)
- [Feed publication and cursor recovery](docs/FEED_PUBLICATION.md)
- [Event model](docs/EVENT_MODEL.md)
- [Ingestion](docs/INGESTION.md)
- [Content engine](docs/CONTENT_ENGINE.md)
- [Security](docs/SECURITY.md)
- [Operations](docs/OPERATIONS.md)
- [Roadmap](docs/ROADMAP.md)
