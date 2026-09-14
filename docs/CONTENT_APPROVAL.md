# Draft-first content approval

Implemented locally; NOT deployed or migrated in production.

## Operator flow

1. A rebuilt content worker generates a `draft`, with no publication time or feed sequence.
2. An approved administrator signs into the existing control room.
3. Under **Drafts awaiting approval**, review the match date, full text and short alert.
4. Select **Approve and publish** and confirm the exact text. This publishes to feed clients,
   not email. Published content cannot be edited, unpublished or deleted here.
5. **Recent approvals** shows the latest 20 approvals with administrator, time and reviewed text.

Drafts are listed 50 at a time with a load-more cursor. Unapproved drafts remain private.
This version does not implement editing, rejection, bulk approval, or automatic approval.
Draft accumulation therefore needs operator attention before any long-running trial.

## Guarantees and boundaries

- Generator explicitly stores draft status; database default also changes to draft.
- Existing published rows and feed cursors are preserved, not reset or backfilled.
- Approval requires the existing approved-admin session, same-origin JSON request and
  custom request header. The actor is derived from the session, never trusted from the body.
- A SHA-256 fingerprint identifies the reviewed content fields. A stale fingerprint,
  missing row, or already-published row returns conflict; reload before trying again.
- A short schema-aware row-locking transaction commits audit and publication together.
  Concurrent approvals have one winner. The existing database trigger assigns the
  commit-ordered publication sequence. Failed audit or publication rolls back both.
- Worker retries cannot republish, duplicate or turn approved content back into draft.
- Approval history uses a new RLS-enabled table, with no browser Data API policies.
  Server database credentials remain trusted; this is not protection against a privileged
  operator issuing direct SQL or an older worker explicitly inserting published rows.
- Page data uses textContent; approval data and history are behind authentication and no-store.
- The approval gate controls generated content in `/v1/feed`. Existing fixture/event
  data endpoints still expose collected football facts to authorized API clients;
  this is not a global pause of all API data.

## Required deployment order — separate approval needed

1. Review/commit code, verify CI and take/verify a suitable database recovery point.
2. Stop **all old content workers**. Do not run a mixed old/new worker fleet: old binaries
   explicitly publish content and bypass draft-first generation even after the migration.
3. Apply `20260914000000_draft_approval` to the intended database, after reviewing it.
   No production migration is executed by this implementation task.
4. Regenerate Prisma and rebuild/deploy the admin application and all worker dependencies.
   The admin store needs the new approval table; deploy it only after migration succeeds.
5. Start only the rebuilt workers in an explicitly approved bounded trial. Verify draft
   creation and absence from `/v1/feed`, then approve one item and verify it appears once.
6. Keep workers stopped if rollback is required. Restoring an old worker binary re-enables
   automatic publishing. Do not delete approvals or reset feed history as a rollback shortcut.

The public API already filters for published content. Its deployment need not change for
this behavior, but live idle-connection reliability remains a separate launch check.

## Local tests

- Admin auth/CSRF/session-derived actor and logout denial.
- Draft invisibility, later approval visible after an existing feed cursor.
- Concurrent approval exactly once; stale content rejected; audit failure rolls back.
- Published content immutable, retries preserve the original item.
- Four-worker sandbox asserts generated content is draft with no publication metadata.
- Offline browser preview checks desktop/mobile rendering; mutations are disabled there.

Run with local sandbox services only: `pnpm sandbox:test` and `pnpm sandbox:pipeline`.
The historical preview made before this change remains a dated test artifact, not current
publication behavior. New replay previews describe draft-first generation.
