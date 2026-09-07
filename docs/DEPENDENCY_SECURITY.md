# Dependency security checkpoint — 2026-09-07

The initial `pnpm audit --json` reported 15 advisories: 2 critical, 6 high,
6 moderate, and 1 low. After the updates below, `pnpm audit --audit-level low`
reports zero known vulnerabilities. This is a point-in-time registry audit,
not proof of exploitability before the changes or absence of all security defects.

## Changes and reachability

| Component                 | Remediation                                        | Exposure assessment                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fastify                   | API and admin: 5.6.0 → 5.12.3                      | Runtime HTTP server. Forwarded-header handling is relevant to configured proxy trust. Current partner routes are GET-only and do not send Web Streams or use body schemas; the schema/stream findings are not demonstrated exploits in these routes. |
| Swagger UI / static files | UI 5.2.3 → 6.1.1; static server resolves to 10.1.3 | Runtime documentation assets are publicly served. No private static directory or directory listing is intentionally configured, but the vulnerable static server was present.                                                                        |
| Vitest                    | 3.2.4 → 3.2.7                                      | Development/CI tool. The reported critical issue requires its UI server; repository scripts use `vitest run`, not an exposed UI.                                                                                                                     |
| shell-quote               | `concurrently>shell-quote` pinned to 1.10.0        | Development launcher uses fixed commands, not partner-provided shell commands. Both reported issues are patched anyway.                                                                                                                              |
| deepmerge-ts              | `@prisma/config>deepmerge-ts` pinned to 8.0.2      | Prisma CLI configuration loader, not the partner request path. The repository uses trusted record-shaped configuration rather than recursive objects or Maps.                                                                                        |
| mysql2                    | `prisma>mysql2` pinned to 3.24.3                   | Transitive Prisma tooling dependency. This application uses PostgreSQL and does not establish MySQL connections.                                                                                                                                     |

Audit output can show one representative path for a shared version; the Fastify
update applies to both API and admin. The Vercel packager continues to exclude
development tooling/optional workspace-root peers. Do not infer deployed exposure
solely from the registry audit's development/production labels.

## Temporary override policy

Overrides are scoped to their actual parent packages in root `package.json`;
there is no global override and no advisory ignore list. `deepmerge-ts` crosses
a major version because Prisma 7.10.0 pins the affected 7.1.5 release. Version 8
changes Map merging and mutation behavior; repository configuration uses neither.
Prisma config API checks, real config-file loading during generation/validation,
and isolated migration tests check the operations this repository uses. This is a
tested local compatibility decision, not a claim of upstream Prisma certification.

Remove each override when its parent resolves a patched version naturally, then
rerun the full checks. Reassess the deepmerge override before introducing Maps,
custom merge functions, or new Prisma configuration features. Prisma itself remains
at 7.10.0; its advertised latest tag currently points to a major prerelease, which
was not adopted for this security patch.

## Verification and maintenance

- `pnpm audit:dependencies` audits all dependencies and fails at low severity or
  higher. CI runs it after frozen-lockfile installation on every push/PR. Registry
  failures are not silently ignored. This does not set up scheduled monitoring.
- Regression tests cover untrusted forwarded host/protocol and Content-Type body
  validation edge cases. Existing API admission, feed, and queue tests remain.
- Runtime smoke checks cover native Argon2 and Prisma configuration. Vercel artifact
  checks now also request documentation HTML and a CSS asset, not just JSON.
- CI exercises migrations on isolated PostgreSQL schemas and independent worker
  crash recovery. No production migration, key rotation, or provider request is
  part of this dependency update.

GitHub CI and Vercel's Git deployment are independent: this audit check does not
by itself prevent Vercel deployment before CI finishes. Deployment gating,
container/OS vulnerability scanning, action pinning, and external monitoring are
separate follow-up work. Fastify's existing top-level `disableRequestLogging`
setting still works on version 5 but is deprecated for the future version 6 upgrade.

## Maintainer references

- [Fastify forwarded-header advisory](https://github.com/fastify/fastify/security/advisories/GHSA-444r-cwp2-x5xf)
- [Static path normalization advisory](https://github.com/fastify/fastify-static/security/advisories/GHSA-8pvw-jcv7-9cmj)
- [Vitest UI advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp)
- [deepmerge-ts version 8 changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)
- [MySQL2 compressed-protocol advisory](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-rgwj-5xj2-c3m3)
