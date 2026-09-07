# Deploying the partner API to Vercel

The repository emits a self-contained Build Output API v3 function. It does not
rely on Fastify source-entry autodetection or workspace symlinks into the checkout.
`pnpm build:vercel` generates Prisma, builds the API and its workspace dependencies,
uses pnpm 10.15.1's legacy production deploy mode to install the complete dependency
tree inside the function, then verifies the artifact outside the repository.
Native dependencies stay as packages, not inlined into an ESM bundle.

## Project settings

Use the existing API project; no new paid resources are required by this change.

| Setting                              | Repository-root project          | Existing apps/api project                    |
| ------------------------------------ | -------------------------------- | -------------------------------------------- |
| Root Directory                       | repository root                  | `apps/api`                                   |
| Framework Preset                     | Other                            | Other                                        |
| Node.js version                      | 24.x                             | 24.x                                         |
| Include files outside Root Directory | not needed                       | enabled                                      |
| Install Command                      | `pnpm install --frozen-lockfile` | `cd ../.. && pnpm install --frozen-lockfile` |
| Build Command                        | `pnpm build:vercel`              | `cd ../.. && pnpm build:vercel apps/api`     |
| Output Directory                     | `.vercel/output`                 | `.vercel/output`                             |

Both layouts have a checked-in `vercel.json`. Remove conflicting dashboard command
overrides and do not use the Fastify preset or `src/app.ts` as a custom entrypoint.
Redeploy without the old build cache. Build on Vercel/Linux, not Windows, when
uploading a production artifact: native binaries must match the target platform.

The function explicitly starts at `dist/handler.js`. It initializes Fastify once per
instance, never opens a listening port, and reuses database/Redis clients. Initialization
failure clears the cached promise so subsequent requests can retry. Redis operations
have bounded command timeouts. All URL paths route to the same API; this does not
deploy a frontend. Use `/docs` rather than `/` to inspect the API.

## Runtime prerequisites and rollout

Configure `DATABASE_URL`, `REDIS_URL`, `CURSOR_SIGNING_SECRET`, `API_FOOTBALL_BASE_URL` and `API_FOOTBALL_KEY`
in Vercel's environment settings (the shared validator currently requires the provider
key even for the API). Use externally reachable services, never localhost. The API and
workers must share the database, Redis store, and `QUEUE_PREFIX`. Size database pools
for Vercel concurrency. Do not expose environment files in the build artifact.

Apply required database migrations separately using the coordinated rollout in
[FEED_PUBLICATION.md](FEED_PUBLICATION.md). Builds deliberately do not migrate, seed,
rotate cursors, or call the football provider. A successful build does not establish
database/Redis connectivity or prove migrations have been applied.

This deployment contains only the partner API. The existing ingestion, event,
content, and outbox workers are long-running services and must still be hosted
separately; deploying the API does not start them.

## Verification

`pnpm build:vercel` automatically runs the artifact check. Repeat it with
`pnpm verify:vercel` (or `pnpm verify:vercel apps/api` for that layout).
The check validates routing and runtime metadata, rejects links outside the function
and environment files, copies the artifact to an owned temporary directory, and loads
the actual handler without workspace links or inherited application credentials.
It checks native Argon2 hash/verify, fail-fast configuration handling, and Fastify
OpenAPI rendering. CI runs this on Linux/Node 24 in addition to existing tests.

After deployment verify `/docs`, `/docs/json`, `/v1/health`, then authenticated feed
polling against the intended migrated database. Health includes worker heartbeats;
an API-only deployment may legitimately report missing workers. Live routing,
Vercel settings, and external connectivity require this separate deployment check.

References: [Build Output API](https://vercel.com/docs/build-output-api),
[function packaging](https://vercel.com/docs/build-output-api/primitives).
