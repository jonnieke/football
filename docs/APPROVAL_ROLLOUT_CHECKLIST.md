# Draft approval: release readiness

Reviewed locally on 2026-09-14. This is a preparation document, not evidence of a
production deployment. Baseline commit: `78c2986`; the release includes uncommitted
changes and untracked files, so that commit alone does not reproduce the tested code.

## Decision

**Not yet cleared for production.** Local feature tests passed; release packaging,
remote CI and live operational prerequisites still need verification.

## Evidence available

- 207 unit/admin tests passed.
- 16 database/queue integration tests passed.
- The rebuilt four-worker pipeline test passed with generated content remaining drafts.
- Desktop/mobile offline admin checks passed. Cancelling confirmation sent no approval
  request. This mock preview is not a live login or production approval test.
- Local test database and Redis containers were stopped after testing; volumes retained.
- No production migration, deployment or live content approval was performed.
- After adding the CI steps, the local admin build passed its isolated handler,
  assets and protected-dashboard verification. The explicitly enabled four-worker
  test passed again (one test); workflow YAML formatting also passed. These checks
  used a sanitized local test environment, not a GitHub-hosted runner. Packaging
  emitted dependency deprecation/peer warnings but completed successfully.

## Release checks before any production change

- [ ] Review the complete working-tree diff and new files. Earlier dashboard, runtime,
      sandbox and build changes accompany approval; do not stage everything blindly or
      release only the new approval files without their dependencies.
- [ ] Confirm credentials, local captures, build outputs and private environment files
      are excluded from the release. Ignore rules exist but are not a complete secret scan.
- [x] Add the missing CI checks in `.github/workflows/ci.yml` (local changes only):
  - Admin artifact build/verification: `pnpm build:vercel apps/admin`.
    The existing no-argument build still checks the API.
  - Separate four-worker pipeline: `pnpm exec vitest run tests/workers/ingestion.test.ts`
    with both `RUN_WORKER_TESTS=true` and `RUN_PIPELINE_TESTS=true`, after the worker
    build. Directly selecting the file avoids the broad worker-runner filter.
    The existing collector/crash tests are retained. This new step has a five-minute
    timeout and uses CI test services and a loopback simulated provider.
- [ ] Record a reviewed release commit and a passing remote CI run for that exact commit.
- [ ] Before pushing, inspect Git-linked deployment behavior. Do not let a push release
      the new admin against an unmigrated database. Keep any preview isolated from live data.

## Live prerequisites: unverified in this review

- [ ] Reconfirm the intended admin/API projects and database/queue connections without
      copying secret values into tickets, logs or this document.
- [ ] Inventory every worker host and running process, including local terminals and
      containers. Stop all old content workers and record evidence. Old binaries explicitly
      publish and can bypass the new default even after migration.
- [ ] Verify a usable database recovery point and its restore procedure. Do not assume
      a provider plan includes a suitable backup, or treat an environment-file copy as one.
- [ ] Review pending migration history for the exact target; resolve unexpected drift
      before applying anything. Do not baseline/reset production as a shortcut.
- [ ] Obtain approval for the migration, deployments and a bounded live trial. Specify
      the worker host, fixture, duration, request allowance and stop condition first.

## Ordered rollout after approval

1. Keep workers stopped; record the current deployment identifiers and recovery point.
2. Apply the reviewed draft-approval migration to the verified target and verify success.
3. Regenerate Prisma, build and deploy the reviewed admin/worker release. Do not start
   an old worker as a fallback. See `CONTENT_APPROVAL.md` for the migration identifier.
4. Check authenticated admin access and anonymous denial. Check database/queue health
   and API behavior after idle time; local tests do not prove live connection reliability.
5. Run the agreed bounded trial with rebuilt workers. Confirm drafts are visible to
   administrators but absent from `/v1/feed`.
6. Review one real draft and obtain the operator's explicit publishing decision. Confirm
   one feed item and one approval audit record, including the correct administrator.
7. Stop the trial at its agreed limit. Review errors, queue backlog and provider usage
   before authorizing continuous operation.

## Stop / rollback rules

- On unexpected publication, wrong connections, migration failure or missing audit:
  stop the trial and keep workers stopped while investigating.
- Keep the additive schema and approval history unless a separately reviewed recovery
  requires otherwise. Do not delete published content or reset feed cursors.
- Rolling back the application does not undo publication. An old content worker can
  restore automatic publishing, so application rollback alone is not a safe recovery.
- Restoring a database can lose newer writes and requires a separate recovery decision.

## Operator limits to accept before a longer trial

There is no draft editing, rejection, bulk approval or unpublish action yet. Approval
publishes to the feed, not email. Assign someone to review drafts and watch accumulation.
The gate covers generated feed content, not the existing football-facts API endpoints.

Next release task: prepare the reviewed release commit and verify remote CI for it.
Adding local workflow steps does not mean GitHub has executed them or branch protection
requires them. Live operations remain a separate approval step.
