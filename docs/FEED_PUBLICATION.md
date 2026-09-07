# Commit-ordered feed publication

## Contract

Published content carries an immutable, database-assigned `publication_sequence`.
The API serializes this bigint as a decimal string. Ordering reflects publication,
not match time, fixture-observation time, or `published_at`. Gaps are permitted.

A PostgreSQL trigger updates a singleton transactional counter when an item is
published. Its row lock lasts until commit or rollback: another publisher cannot
commit a higher position while an earlier position is uncommitted. An ordinary
sequence (`nextval`) would not provide this guarantee. Keep publication transactions
short; do not perform provider, queue, or other network calls while holding this lock.
The global lock deliberately trades publication concurrency for safe replay.

The feed reads the committed high-water mark first, then queries only positions
above the cursor and at or below that bound. Short and empty pages advance to the
bound; full pages advance to their final item. Empty polls always return a cursor.
Use the same primary database for both reads; split reads across lagging replicas
are not supported. Published payloads and channel/event-type routing are immutable.
The event type is captured on the content row, not derived from a mutable event join.
Drafts may be edited before publication. Published rows cannot be updated or deleted;
editorial corrections must be appended. A complete correction/withdrawal workflow
and a retention protocol remain future work.

## Client recovery

Cursors are signed, versioned, bounded in size, and tied to their channel/event-type
filters and feed epoch. Page size can change. Clients must save the returned cursor
after processing the page, even when empty, and deduplicate content IDs on replay.
This is resumable delivery, not a claim of exactly-once processing by the partner.

HTTP 409 `CURSOR_RESET_REQUIRED` means restart without `after`. HTTP 400
`CURSOR_SCOPE_MISMATCH` means preserve the original filters or restart. Invalid
signatures return HTTP 400 `INVALID_CURSOR`; secret rotation also requires clients
to restart. Keep cursor-signing configuration consistent across API instances.

## Migration rollout

1. Back up the database and test the migration on a copy. Arrange client cursor
   reset/replay handling before deployment: v1 timestamp cursors are not convertible
   safely and are explicitly retired.
2. Stop publication workers and place the API in maintenance before migration.
   The migration takes an exclusive content-table lock. Reconcile any legacy
   `status = 'published'` rows with no `published_at`; the migration refuses them.
3. Deploy migration `20260910000000_commit_ordered_feed` and matching application
   binaries together. Existing timestamped rows receive deterministic positions
   ordered by timestamp/ID. This cannot reconstruct historical commit order.
   Previously withdrawn timestamped rows stay excluded and become immutable too.
4. Verify the state row, feed replay, and worker publication before resuming traffic.
   Clients receiving 409 restart without `after`, deduplicating already-seen IDs.

No application database migration was executed during implementation. Fresh-schema
CI tests exercise migration application and concurrency; an actual historical-data
upgrade rehearsal remains an operator requirement.

## Database restore

After **every database restore**, while API and workers remain stopped, run:

```sh
pnpm feed:reset-cursors operator-name "Restored backup; start a new feed history"
```

This rotates the feed epoch and writes an operator/reason incident atomically; it
does not rewrite content or its positions. Resume traffic only after it succeeds.
A restored snapshot can reuse sequence positions, so checking only whether a cursor
is ahead is insufficient. Restore detection is not automatic. Rotating the epoch
forces all existing v2 clients to reset rather than silently skip reused positions.

## Verification boundaries

Unit tests cover bigint precision, signatures, cursor versions, scopes, high-water
bounds, empty polls, and resets. Isolated PostgreSQL tests cover delayed publication,
concurrent commit and rollback, observed lock contention, frozen routing/payloads,
and epoch rotation. API integration checks empty-poll cursors and scope errors.
The independent worker crash/recovery test also runs against this schema.
