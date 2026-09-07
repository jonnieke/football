# Security

- Environment variables are validated at startup; secrets are absent from source.
- Partner keys use random entropy, a lookup-only prefix, and Argon2id hashes.
- Disabled/revoked clients cannot authenticate.
- Redis enforces per-client rate limits; PostgreSQL logs request metadata without authorization headers.
- Helmet sets secure headers; request bodies are limited; Zod validates input.
- Prisma parameterizes database access.
- Pino redacts authorization/API-key fields.
- Production errors do not expose stack traces.
- Cursors are HMAC-signed to reject tampering.

Rotate cursor secrets with a planned compatibility window because rotation invalidates old cursors. Rotate provider credentials outside the repository. Restrict database and Redis network access in deployed environments.
