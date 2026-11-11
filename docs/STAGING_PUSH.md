# Live-score staging-table delivery

**Superseded by API delivery (2026-09-26).** New publications no longer enqueue
staging-table jobs. Do not deploy or enable this optional worker for the current
rollout. The receiving developer consumes the authenticated live API from their
own network and owns insertion into their private database. The implementation
below is retained as reference only; see [Live partner API](LIVE_PARTNER_API.md).

Fresh automatically published football alerts are queued durably in PostgreSQL
and delivered by the separate `@fcp/staging-push` worker. Historical/draft
content is never queued. Messages are non-empty and at most 150 characters.

The receiver contract is the developer-supplied parameterized equivalent of:

```sql
INSERT INTO content_schedual_allday
  (message, MenuCMD, MessagePushTime, UploadedBy)
VALUES
  (?, 'All Day News/LiveScores', NOW(), 'Football Content Platform');
```

The implementation passes all values as parameters. It intentionally omits the
auto-generated record ID and receiver status column, allowing the target table
to default new records to pending (`0`). The receiving system owns its `0` to
`1` processed transition.

## Delivery behavior

- One internal delivery row is created atomically with each new publication.
- Temporary MySQL failures release the lease and retry with bounded backoff.
- MySQL duplicate-key rejection is treated as already delivered because the
  receiving system explicitly guarantees duplicate blocking.
- A message that cannot be delivered within ten minutes expires instead of
  publishing stale live news.
- Schema, access, and invalid-message errors fail permanently for operator
  review. Logs contain statuses/error codes, never messages or credentials.
- The Supabase delivery ledger has RLS enabled and all access revoked from
  `PUBLIC`, `anon`, and `authenticated`; only the private database worker role
  should use it.

## Required private configuration

Keep these values only in the VM's root-owned worker environment file:

```dotenv
STAGING_PUSH_ENABLED=true
STAGING_DATABASE_URL=mysql://username:password@host:3306/database
STAGING_PUSH_POLL_INTERVAL_MS=1000
```

TLS certificate verification is mandatory. If the MySQL server uses a private
CA, save it as `/var/lib/fcp/staging-mysql-ca.crt` and set:

```dotenv
STAGING_DATABASE_SSL_CA_FILE=/secrets/staging-mysql-ca.crt
```

## Rollout order

1. Back up Supabase and apply migration
   `20260925000000_staging_push_delivery`.
2. Build and deploy a worker image containing `workers/staging-push/dist`.
3. Add the target credentials and optional CA without printing them.
4. Run `docker/launch-staging-push.sh --check`; it performs no network access.
5. Verify an encrypted, read/write-limited MySQL account can access only
   `content_schedual_allday`.
6. Start the sender with `docker/launch-staging-push.sh --start`.
7. With the receiver's approval, publish one clearly identified staging message
   and verify its target status changes from `0` to `1`.

Do not start this sender with guessed credentials, an unencrypted database
connection, or against a production table that has not been approved for the
staging test.
