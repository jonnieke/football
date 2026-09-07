# Safe test execution

`pnpm test:unit` runs domain and test-harness unit tests without external stores.
`pnpm test` skips integration unless `RUN_INTEGRATION_TESTS=true`.
`pnpm test:integration` explicitly enables integration and fails if required
test settings are missing. It does not load `.env` or fall back to application
connection settings.

## Integration prerequisites

Use local PostgreSQL and Redis dedicated to development/testing. Test database
names must contain a `test` segment (for example `football_content_test`). The
Redis URL must explicitly select database 1 through 15. Remote hosts and URL
query overrides are rejected. Test targets must differ from any configured
application `DATABASE_URL` and `REDIS_URL`.

With the repository's Docker services available, create the test database once:

```powershell
docker compose up -d postgres redis
docker compose exec postgres createdb -U football football_content_test
$env:TEST_DATABASE_URL = 'postgresql://football:football@localhost:5432/football_content_test'
$env:TEST_REDIS_URL = 'redis://localhost:6379/1'
pnpm test:integration
```

If that database already exists, reuse it; do not drop it to repeat the tests.
The test role needs permission to create schemas and apply the repository's
migrations within the test database. No pre-test `pnpm db:migrate` is required.

## Isolation and cleanup

- Configuration is validated before clients are constructed.
- Each run creates a random `fcp_test_<32 hex digits>` PostgreSQL schema.
- Prisma migrations and generated queries target that schema.
- Each run prefixes API Redis keys with the same random namespace.
- Normal teardown drops only a schema this run successfully created and
  deletes only the exact Redis keys touched through its wrapper.
- Partial setup also attempts cleanup and reports cleanup failures.
- No `FLUSHDB`, wildcard deletion, or table-wide data reset is used.
- Database/Redis connection waits and migration execution are bounded.

This protects ordinary runs and concurrent suites; it is not a sandbox for
untrusted migration SQL or arbitrary Redis Lua. Keep using a separate test
database, not production tunnels or production credentials. A forcibly killed
process may leave its isolated schema behind; inspect ownership and the exact
schema name before any manual cleanup. Never drop the whole test database to
clean one run.

The integration suites exercise repositories, deterministic content, Fastify
feed requests, outbox transaction rollback/recovery, and immutable fixture
observations (event-only changes, reordered replay, final-state reconciliation,
and concurrent stale-writer protection). The outbox suite
simulates queue transport while using real database transactions. These are
**not yet** independent queue-worker end-to-end tests; actual Redis/worker
failure-injection verification remains a later acceptance stage.
