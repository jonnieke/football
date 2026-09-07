# Ingestion

The ingestion worker acquires a Redis distributed lock, loads enabled competitions, requests live fixtures once per configured poll, normalizes them, upserts entities, and appends state snapshots only when football state changes. Changed snapshots are queued by stable job ID. Polling is independent of subscriber/partner volume.

The API-Football adapter applies a request timeout, bounded exponential retry for timeouts/429/5xx, response validation, rate-limit-aware logging, and a health probe. Provider errors update polling runs and health keys without deleting durable state.
