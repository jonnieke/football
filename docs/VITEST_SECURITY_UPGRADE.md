# Vitest security upgrade — 2026-09-15

Validation below was recorded locally before committing and pushing this upgrade.
It is not evidence of a successful remote CI run or production deployment.

GitHub run `34900018400` for release `b4f9d26` stopped at the dependency audit.
Vitest and its mocker dependency were flagged by
[GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

## Change

- Pin Vitest to patched version `4.1.11` and refresh its lockfile dependencies.
- Limit test discovery to `apps`, `packages` and `tests`, accounting for Vitest 4's
  changed default exclusions. No application logic or test assertions changed.
- Keep the existing full dependency audit at severity `low`; no exceptions added.

## Local verification

- Dependency audit: no known vulnerabilities reported.
- Repository-wide ESLint and TypeScript checks: passed.
- Sequential unit/API/admin/integration run: 248 tests passed across 43 files.
- Separate rebuilt crash-recovery/collector run: 3 tests passed.
- Separate rebuilt four-worker draft pipeline: 1 test passed.
- An initial two-process run had one login integration timeout (247 passed).
  The same test passed in 501 ms on the full sequential rerun. No timeout was relaxed.
- Existing Fastify deprecation warnings appeared; they did not fail the checks.

The three worker tests skipped in the broad run were explicitly enabled and passed
in the separate worker run. All database/queue tests used local isolated resources;
no production migration, provider requests, email sends or deployment were performed.

Next: commit and push the narrow upgrade, with Vercel build holds still verified,
then require a successful GitHub CI run. Local results do not establish remote CI success.

Compatibility reference: [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration).
