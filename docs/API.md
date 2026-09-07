# Partner API

All partner endpoints use bearer API keys. Keys are shown once, stored as Argon2id hashes, can be revoked, and have per-client Redis-backed minute limits. `GET /v1/health` and `/docs` do not require a key.

`GET /v1/feed` returns published content in stable ascending `(published_at, id)` order. `limit` defaults to 100 and is capped at 500. Pass the opaque `next_cursor` back as `after`; filters `channel` and `event_type` are supported. Durable PostgreSQL storage lets disconnected partners replay missed content.

The other Phase 1 endpoints are `/v1/competitions`, `/v1/fixtures/live`, `/v1/fixtures/:id`, `/v1/events`, and `/v1/events/:id`. No route exposes raw API-Football payloads.

Errors:

```json
{
  "error": {
    "code": "INVALID_CURSOR",
    "message": "The supplied cursor is invalid.",
    "request_id": "req_..."
  }
}
```

HTTP 401 indicates invalid/revoked credentials; 429 includes `Retry-After`; validation failures return 400; missing resources return 404.
