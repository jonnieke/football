# Partner API

All partner endpoints use bearer API keys. Keys are shown once, stored as Argon2id hashes, can be revoked, and have per-client Redis-backed minute limits. `GET /v1/health` and `/docs` do not require a key.

`GET /v1/feed` returns published content in ascending, commit-ordered `publication_sequence` order. This field is a decimal string, not a JavaScript number. `published_at` is display metadata, not the ordering key. `limit` defaults to 100 and is capped at 500. Pass the opaque `next_cursor` back as `after`, including after an empty response. Filters `channel` and `event_type` must stay unchanged when reusing a cursor; page size may change. Durable PostgreSQL storage lets disconnected partners replay missed content.

Cursor v2 replaces timestamp cursors. A valid old cursor, a cursor from a different feed epoch, or a cursor ahead of restored history returns HTTP 409 `CURSOR_RESET_REQUIRED`. Restart without `after` and deduplicate by content ID. Changed filters return HTTP 400 `CURSOR_SCOPE_MISMATCH`; malformed or incorrectly signed cursors return HTTP 400 `INVALID_CURSOR`. Save each returned cursor only after successfully processing its page. See [feed publication and recovery](FEED_PUBLICATION.md) for rollout and restore requirements.

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
