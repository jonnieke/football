# Admin league coverage

Admin and database migration deployed on 2026-09-15. Worker rollout remains pending;
see [release evidence](RELEASE_2026-09-15.md).

The control room lists API-Football league/season selections (100 per page).
Add a provider league ID, display name and season start year. New entries are
paused. Enable or pause each season explicitly. Seasons are separate records;
there is no destructive delete or season rewrite for existing fixtures.

This first version uses an explicit provider ID, not a searchable provider
catalog. It does not claim to validate subscription coverage or league IDs.
Provider ingestion refreshes display metadata when fixtures arrive. Existing
selections remain unchanged by the migration.

Both reads and mutations require an approved admin session. Mutations require
same-origin JSON requests, reject client-supplied actors, validate inputs, and
use a coverage version to reject stale concurrent edits. Every successful change
records actor, time and before/after values atomically. Audit failure rolls back
the setting. The new audit table has RLS enabled and no browser Data API grants.

The ingestion worker reads selections each polling cycle. All paused is a valid
idle state, making no provider requests. An already-running poll can finish.
Automatic publication obtains a shared competition advisory lock in its transaction;
admin pause takes the matching exclusive lock. After pause commits, subsequent
automatic publication cannot use the old enabled value. Reports committed before
pause remain visible. Optional manual publication is separate and is not disabled
by a league pause. Resuming does not replay withheld drafts as breaking news.

Enabling is configuration, not proof that workers are running. Continuous worker
hosting, notification sending and provider allowance monitoring remain separate
rollout steps. Broad fixture discovery still queries provider live/date endpoints
then filters selections; selection is not a guarantee of proportional API savings.

Migration: `20260915091912_league_controls`, named by the Supabase CLI and placed
in this repository's existing Prisma migration chain (not a second migration system).
Before rollout: back up, test the migration, apply it deliberately, deploy the
matching admin and workers, then validate unattended reporting on the chosen season.

## Local verification — 15 September 2026

- 25 targeted admin/security/browser-script/freshness tests passed.
- 5 isolated PostgreSQL integration tests passed: league changes, concurrent
  edits, rollback on audit failure, RLS, automatic publication and historical drafts.
- Four-worker simulated-provider pipeline passed, including repeated healthy idle
  polls with zero additional provider requests after all leagues are paused.
- Browser → authenticated API → isolated PostgreSQL → rendered result checked:
  add paused season, enable, pause, audit actor and history; no browser errors.
  Desktop and 390px-wide form reviewed; no horizontal overflow.
- TypeScript, changed-file ESLint and whitespace checks passed.

No live database migration, provider request, notification, worker start or
deployment was performed. Local test workers were started only against the
simulated provider and disposable test schemas.
