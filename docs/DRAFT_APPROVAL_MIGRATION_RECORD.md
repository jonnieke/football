# Draft-approval production migration

Verified: 2026-09-14 22:28:42 UTC / 2026-09-15 01:28:42 Africa/Nairobi.
Target: Supabase project `dsholtmeyivyjwiuzedb`, schema `public`.
Reviewed release: `6549ab62b86ac9c6d7d294c7d54f001076f539ab`.
Migration: `20260914000000_draft_approval`.

## Authorization and prerequisites

The operator explicitly approved this database update only, after confirming no
workers had been started on Google Cloud or another computer. The prior local
process/container check found no workers running. CI passed for the exact release.
All six previous migration checksums matched the repository, with only this migration
pending. A private application-schema backup passed an isolated PostgreSQL 17 restore
test, including all 18 application tables' row counts and data digests.

The backup covers `public`, not the complete Supabase project. It remains outside
the repository and is not an off-device disaster recovery copy.

## Operation and verification

- Used the existing strict TLS connection with the supplied CA. The connected
  Supabase tool remained inaccessible; direct PostgreSQL access was used.
- Checked the migration SQL against the reviewed Git commit and verified the backup
  checksum before applying any change.
- Applied the unchanged migration body in one transaction, with short lock and
  statement timeouts. Removed only the outer transaction wrappers in memory.
- In that same transaction, revoked all table privileges on the new approval table
  from PUBLIC, anon, authenticated, and service_role, preserving the existing
  deployment-specific direct-database-only security model. No global default grants
  or existing tables' privileges were changed.
- Verified draft default, valid draft index, approval table primary/unique/foreign
  key constraints, enabled RLS, zero policies, and no effective table or column
  privileges for the three Data API roles before committing.
- Recorded the actually executed migration with Prisma `migrate resolve --applied`.
  No migration ledger rows were written manually.
- Rechecked all seven completed migration records and their exact file checksums.
  No unfinished or rolled-back migration records were present.
- Content count remained zero, approval count was zero, and content/feed-state
  fingerprints were unchanged. No content was inserted, published, or deleted.

Migration SHA-256:
`8b31c0ed0e969e20197676806487115456951b9beaa53b8d1d5a8d360ec7e10c`.

## Remaining release steps

No admin/API deployment, worker startup, provider request, or publication was performed.
The new approval UI is not live merely because its database table exists. Deploy the
reviewed admin release next only with approval, then verify authenticated access.
Workers must remain stopped until a separately agreed bounded trial of rebuilt workers.
Old workers can still explicitly publish and must not be used as a rollback fallback.

Keep the additive schema on an application rollback. Restoring the backup, deleting
approval history, or changing feed cursors requires a separate recovery decision.

## Subsequent admin deployment (2026-09-15)

After the operator requested the next rollout step, deployed the reviewed application
source to `football-control-room` only. Uncommitted changes at upload were operational
documentation, not application code. Deployment:
`dpl_DSkmANRxcmHSJP6EitCoSD7s2kNq` / `football-control-room-flyq4w57f.vercel.app`.
Built remotely with production configuration and initially withheld domain promotion.
Vercel reported READY. `/health` and `/login` returned 200; unauthenticated
`/api/content/drafts` returned 401. Promoted the same deployment, then confirmed
200 responses at `https://football-control-room.vercel.app/health` and `/login`.

No worker startup, live approval, email request, API deployment, or change to the
other projects' build holds was performed. Operator sign-in and authenticated
dashboard/draft verification remain outstanding; public health is not evidence
that every authenticated database operation works.
