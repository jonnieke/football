# Database entity model

```text
competitions 1---* fixtures *---1 teams (home)
                         *---1 teams (away)
fixtures     1---* fixture_states
fixtures     1---* football_events *---0..1 players
football_events 1---* content_items
content_templates       api_clients 1---* api_request_logs
polling_runs             system_incidents
```

`competitions`, `teams`, and `players` use `(source, source_id)` uniqueness. `fixtures` uses `(source, source_fixture_id)`. `fixture_states` is append-only. `football_events.event_fingerprint` is globally unique and is the durable idempotency boundary. `related_event_id` creates an auditable correction chain. Content has one deterministic item per `(event_id, channel, content_type)`. API keys are represented only by a prefix and an Argon2id hash.

Feed ordering uses `content_items.published_at ASC, content_items.id ASC`; both values are encoded into an opaque cursor. Request logs exclude credentials and authorization headers.
