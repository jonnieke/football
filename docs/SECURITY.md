# Security

Dependency updates and audit policy: [DEPENDENCY_SECURITY.md](DEPENDENCY_SECURITY.md).

- Environment variables are validated at startup; secrets are absent from source.
- Partner keys use random entropy, a lookup-only prefix, and Argon2id hashes.
- Disabled/revoked clients cannot authenticate.
- Redis enforces pre-authentication IP/prefix limits before database lookup or Argon2, followed by authenticated per-client quotas.
- Instance-local verification concurrency limits bound simultaneous Argon2 work.
- PostgreSQL logs authenticated request metadata without authorization headers; anonymous failures do not produce database log writes.
- Helmet sets secure headers; request bodies are limited; Zod validates input.
- Prisma parameterizes database access.
- Pino redacts authorization/API-key fields.
- Production errors do not expose stack traces.
- Cursors are HMAC-signed to reject tampering.

Rotate cursor secrets with a planned compatibility window because rotation invalidates old cursors. Rotate provider credentials outside the repository. Restrict database and Redis network access in deployed environments.

## Authentication admission controls

Protected endpoints consume an IP attempt budget first, then a key-prefix budget
before client lookup, then enter a bounded Argon2 verification gate. Successful
authentication still consumes the client's existing delivery quota. Invalid keys
longer than 512 characters never reach lookup or hashing. Disabled/revoked clients
are still rejected on each request; no successful-auth cache delays revocation.

| Setting                 | Default | Meaning                                                                                 |
| ----------------------- | ------- | --------------------------------------------------------------------------------------- |
| `API_AUTH_IP_LIMIT`     | 600     | Attempts per IP per 60-second fixed window                                              |
| `API_AUTH_PREFIX_LIMIT` | 600     | Attempts per key prefix per 60-second fixed window                                      |
| `API_AUTH_CONCURRENCY`  | 4       | In-flight Argon2 checks per API instance; maximum configurable value 32                 |
| `API_TRUSTED_PROXIES`   | empty   | Comma-separated proxy IPs/CIDRs explicitly allowed to supply forwarded client addresses |

These budgets count successful requests too. Set them above legitimate partner
traffic (including clients sharing a NAT); they can otherwise be stricter than a
partner's configured quota. Prefix limits also throttle distributed guesses against
a known key prefix, at the cost of potential targeted denial of service for that key.
This is not comprehensive distributed-DDoS protection: edge limits and monitoring
are still required. Concurrency is per instance, not a global fleet-wide cap.

Exhausted attempt budgets return 429 `AUTH_RATE_LIMIT_EXCEEDED` with `Retry-After`.
Malformed/failed Redis responses fail closed with 503 `AUTH_SERVICE_UNAVAILABLE`.
Saturated hash capacity returns 503 `AUTH_CAPACITY_EXCEEDED`; both use a short retry
hint. Both API entry points use Redis command/connect timeouts of five seconds,
bounded per-command retries, and no offline command queue. Queue-worker blocking
connections retain their separate settings. Redis errors do not expose connection
details to callers. Database query timeouts remain separate operational work.

Redis keys are namespaced with `QUEUE_PREFIX` (the default `bull` preserves existing
partner quota keys). Do not put raw API keys into limiter keys or logs. Failed
anonymous requests increment in-memory error metrics but no longer write a database
audit row; use edge/runtime telemetry for abuse investigations. Durable metrics
export and alerting remain outstanding.

## Proxy trust and deployment

Forwarded headers are ignored by default. Only configure IPs/CIDRs of actual trusted
ingress proxies, restrict direct origin access, and make ingress strip/overwrite
untrusted forwarded headers. Boolean trust-all, hop counts, hostnames and `/0`
networks are rejected at startup. Do not infer a safe allowlist from a single request.
Behind Vercel or another shared proxy, the default may group multiple clients into
one IP budget. Verify the ingress contract before configuring trust or raising limits;
no live proxy allowlist was inferred or changed during implementation.

Public exemptions match `/v1/health`, `/docs`, and `/docs/` paths, not lookalikes such
as `/docsevil`. Documentation and health remain public; use platform access controls
and edge rate limiting as appropriate. No WAF rules or deployment protection settings
were changed in this stage.

Reference: [Fastify proxy trust](https://fastify.dev/docs/v5.6.x/Reference/Server/#trustproxy).
