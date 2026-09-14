# Football Supabase bootstrap record

Project: `dsholtmeyivyjwiuzedb`. Schema: `public`.

## Applied setup

The operator approved creating the football schema and protecting it from direct public access. No workers, provider polling, seed, or Vercel update was authorized or performed during this setup.

1. Connected with TLS certificate and hostname verification, using the operator-supplied Supabase CA certificate. The CA was trusted for the command only through `NODE_EXTRA_CA_CERTS`; certificate verification was not disabled and no machine-wide trust settings were changed.
2. Verified zero non-extension relations in `public` and no conflicting feed trigger function.
3. Rehearsed all six existing migrations in one transaction and rolled it back. The two migrations with their own outer `BEGIN`/`COMMIT` had only those outer wrappers removed in memory. Repository migration files were not edited.
4. Applied those same six migrations atomically together with row-level security and privilege revocations. All 17 tables were protected before commit.
5. Used `prisma migrate resolve --applied` to record each migration already executed. The migration tool used the same Supabase pooler's session endpoint with strict TLS and the supplied CA; the saved application URL was not modified.
6. Enabled RLS and revoked direct Data API access on `_prisma_migrations` as well.

## Verification results

- All 17 expected application tables present; no missing application tables.
- RLS enabled on all 17 application tables and the migration ledger.
- No effective table or column privileges for `anon`, `authenticated`, or `service_role` on those 18 tables. The app uses a direct PostgreSQL connection, not Supabase's Data API.
- `assign_feed_publication()` remains a security-invoker trigger function, with `search_path=pg_catalog` and no execute grants to those API roles or PUBLIC.
- Six completed migration records, no unfinished or pending migrations, and all checksums match local migration files.
- Zero enabled competitions, fixtures, content items, pending outbox records, or pending source reviews.
- Initial feed publication-state row exists with high-water mark zero (created by the feed migration).
- Supabase automated security advisor was attempted but the connected tool returned permission denied. Direct PostgreSQL catalog/effective-privilege checks passed; this is not a claim that every project-level advisor check passed.

## Boundaries and follow-up

- No existing user data was removed. Supabase-managed schemas and extension objects were left intact.
- No global default privileges, project-wide Data API settings, Vercel secrets, or Redis service settings were changed.
- The new access protections are deployment-specific, applied by the reviewed bootstrap scripts, not an additional Prisma migration. Preserve these protections in backups/restores and include equivalent controls in future schema changes. New tables are not automatically covered.
- RLS deliberately has no browser-access policies. Direct SQL access by the existing database owner still works. A restricted application database role remains a separate hardening task; do not expose the current owner credentials to clients.
- Do not rerun `bootstrap-football-database.mjs --apply`: it deliberately refuses a nonempty schema. The baseline helper is an operator-only recovery aid for the six migrations actually applied here, not a general migration runner.
- Competitions and the testing window must be chosen before polling. Worker startup, queue compatibility, and Vercel-to-Aiven cutover remain untested/unperformed.
- Local credential files remain Git-ignored. Never commit them or put them in logs. The CA certificate is public, but its local Downloads path is machine-specific.

## Read-only verification on this computer

From the repository root in PowerShell:

```powershell
$previousFootballCa = $env:NODE_EXTRA_CA_CERTS
try {
  $env:NODE_EXTRA_CA_CERTS = 'C:\Users\peterson\Downloads\prod-ca-2021.crt'
  node scripts/workers-database-check.mjs
} finally {
  $env:NODE_EXTRA_CA_CERTS = $previousFootballCa
}
```

This command reports aggregates and metadata only, not credentials or individual records.
