# Event model

Canonical events use the controlled taxonomy in `packages/football-core`. API-Football codes never enter the ledger. Pure comparison ignores timestamps and reports only score/status meaning. Score increases create goal-family events, lifecycle changes create status events, and score reductions create `score_correction`.

Each fingerprint is SHA-256 over fixture, type, minute, added time, team, player, source event, score, and related event. A unique database constraint makes processing idempotent across retries and restarts.

The ledger is append-oriented. A reversed goal is never deleted: a `goal_cancelled` or `score_correction` row is appended and references the earlier event when known. UUIDv7 IDs are permanent and time-sortable.
