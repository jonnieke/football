# Release candidate: control room and draft approval

Prepared locally on 2026-09-15 from baseline `78c2986` on `main`.
No commit, push, remote CI run or deployment is implied by this document.

## Package scope

The initial inventory contained 19 modified tracked files and 43 untracked files.
Do not treat `git diff --stat` alone as the release inventory: it omits new files.

Include these related groups in the final reviewed release:

- Admin control-room dashboard, request-scoped Redis handling, serverless entry point,
  authentication integration, draft review UI and their tests.
- Draft-first delivery, approval transaction/audit schema, migration and integration tests.
- Admin build/package verification, deployment configuration and CI checks for both
  the admin artifact and the combined worker pipeline.
- Isolated replay/capture/test tooling, sandbox compose configuration and tests.
- Operational documentation and ignore rules.

Operational helpers under `scripts/` include live provisioning, database bootstrap,
Redis cutover and smoke-test tools. Including their source does not authorize running
them. They must not become install hooks or automatic deployment/migration steps.

## Exclusions and scan limits

- Private `.env` files, `.vercel` project metadata, generated artifacts and
  `.sandbox-replay` captures/results must remain excluded.
- Git ignore checks confirmed the worker/admin private environment paths, sandbox
  capture path and admin Vercel metadata path are excluded.
- The tracked sensitive-file name check found only `.env.example` among environment,
  PEM/key and sandbox-result patterns.
- A credential-pattern scan of modified/new candidate files found three connection
  strings, all reviewed as test-only: CI, isolated artifact verification and local
  sandbox configuration. No matching private-key or common token pattern was found.
  This is a limited heuristic scan, not a guarantee that every possible secret is absent.
- The admin certificate file has a public certificate header, not a private-key header.

## Release gates still open

1. Complete final source review and record the selected files in a release commit.
2. Verify Git-linked deployment behavior before any push. The current local branch is
   `main`; a push must not accidentally deploy admin before its database migration.
3. Run remote CI for the exact release commit and retain its result.
4. Follow `APPROVAL_ROLLOUT_CHECKLIST.md` for recovery-point verification, worker shutdown,
   migration, deployment and an explicitly approved bounded live trial.

Local artifact verification and pipeline testing passed in the preceding step. These
results do not establish remote CI success or current production readiness.

On 2026-09-15, repository-wide ESLint and TypeScript `--noEmit` checks both exited
successfully. No application source was changed during this packaging review.

## Live Git deployment check (2026-09-15)

Read-only Vercel CLI project listing for the intended team returned all 24 projects
with no further page. The connected app exposed only an unrelated project, so CLI
access was used to verify the football projects. No settings were changed.

| Project | Root | Git repository | Production branch | Git deployments |
| --- | --- | --- | --- | --- |
| api-1lc3 | apps/api | jonnieke/football | main | Enabled |
| api | apps/api | jonnieke/football | main | Enabled |
| real-time-football | apps/api | jonnieke/football | main | Enabled |
| football-control-room | apps/admin | No Git link | Not applicable | No Git-linked trigger |

The three linked projects had no ignored-build command and no deploy hooks in the
returned Git link. A push to `main` must be treated as a possible production deployment
to all three, not merely a CI run. The admin is not automatically deployed by that
repository link. This corrects the earlier hypothetical admin auto-deployment concern.

The local CI workflow runs tests/builds and contains no upload/deploy step. Vercel's
separate Git integration can still deploy; this check does not establish that Vercel
waits for GitHub CI or that branch protection exists. Preview environment isolation and
the current remote workflow were not verified. A non-main push is therefore not yet
cleared as harmless either.

Before pushing, obtain an explicit decision about retaining the two additional API
project links and temporarily holding Git deployments on the linked projects. Do not
delete projects or disconnect repositories without approval. Re-read settings after
any approved change, then push for CI. Database migration and manual admin rollout
remain separately controlled by the rollout checklist.

### Correction and approved temporary hold

The `gitProviderOptions.createDeployments` value above concerns GitHub deployment
records, not an authoritative Vercel auto-build switch. Do not use that field to
disable Vercel builds. Repository/production-branch links remain relevant, but the
earlier interpretation of that flag was incorrect.

With user approval on 2026-09-15, the project-level Ignored Build Step was changed
from `null` to `exit 0` for `api-1lc3`, `api` and `real-time-football`. This is a
temporary build hold, not a repository disconnection or project pause. Vercel
documents exit code zero as skipping the build:
https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel

Restore the previous value (`null`) only with approval when ready to release.
The hold is not a security boundary: an overridden ignore command or a manual
deployment that bypasses it must not be used during release preparation. It also
does not cancel an already-running deployment. No code push or deployment was
performed as part of setting the hold.
