# Live partner API

Deployed to `https://api-1lc3.vercel.app` on 2026-09-15 as
`dpl_BqKd2ZFuEDA1PNGw8VWdTL2vTt75`. Authenticated staged streaming, rotation,
cursor resumption, REST cursor compatibility and revoked-key rejection passed.
That release evidence is historical; it does not describe current worker health.
See [release evidence](RELEASE_2026-09-15.md).

`GET /v1/feed/stream` delivers published reports over Server-Sent Events (SSE).
It uses the existing partner Bearer API key, not dashboard login cookies.
The existing `GET /v1/feed` remains the durable history/catch-up endpoint.
Neither endpoint requires a human to approve normally eligible live reports.

## Connection contract

### Administrator setup and match selection

Sign in to the control room using an approved administrator email. In **API access**,
create a named client and copy the one-time key into the receiving server's secret
store. There is no public signup or restricted developer role: an approved login
has administrator privileges. Approve access deliberately.

In **Leagues**, enable the competitions to collect. In **Matches**, choose a UTC
date and check/uncheck games. Live games also appear regardless of date. Selection
saves immediately, persists across reloads, and controls future publication for
all connected API clients. New games default to selected. Turning a game back on
does not release observations queued before that change. Already published alerts
remain replayable; downstream systems must not interpret a switch as a retraction.

The receiving service can run inside a private network: it initiates outbound
HTTPS to the stream, so MySQL port 3306 does not need public exposure. Read
`items[].text.short` for the notification (new alerts are limited to 150 characters).
The developer owns downstream insertion and deduplication.

Match-control rollout requires migration `20260926000000_match_notifications`
before deploying the updated admin and content worker. Until those components are
deployed together, the new checkboxes are not an active production control.

- Send `Authorization: Bearer <partner-key>` and optionally `Accept: text/event-stream`.
- Optional query filters: `channel` and `event_type`, identical to REST feed filters.
- Without a cursor, streaming begins at the committed publication tip, not historical reports.
- Reconnect with `Last-Event-ID: <saved-cursor>` or query `after=<saved-cursor>`.
  If both are present, they must match. Keep the same filters when resuming.
- Native browser `EventSource` cannot set this Authorization header. Use a server-side
  consumer or authenticated fetch streaming through your own backend. Do not put a
  partner key in URLs, browser bundles, or public frontend configuration.

Each frame is separated by a blank line. JSON `data` occupies one line:

```text
id: <signed-next-cursor>
event: feed
data: {"items":[...],"next_cursor":"<signed-next-cursor>"}

```

Event types:

| Event | Consumer action |
| --- | --- |
| `ready` | Save the initial cursor; start listening. |
| `feed` | Process all items in publication order, then save its cursor. |
| `checkpoint` | No matching items; save the advanced cursor. |
| `reconnect` | Normal connection rotation; reconnect with the last processed cursor. |
| `access_revoked` | Stop; the key was disabled, revoked, rotated, or deleted. |
| `reset_required` | Publication history changed; recover through REST, deduplicating IDs. |
| `stream_error` | Temporary dependency failure; reconnect with backoff and saved cursor. |

Comments (`: heartbeat`) keep idle connections active. The initial `retry: 1000`
suggests one second before normal reconnection. Implement capped exponential backoff
with jitter for failures, honoring HTTP `Retry-After`; stop retrying authentication
failures until credentials are corrected.

## Recovery and correctness

Use the same signed cursors for streaming and REST. Save a cursor only after its
whole batch has been durably processed. Delivery across failures is at least once:
deduplicate by content `id` (and by `event_id` when combining channel variants).
Do not treat a frame arriving as confirmation that your downstream system saved it.

Invalid cursors fail before headers with HTTP 400; filter mismatch is also 400.
A cursor from an old database publication epoch fails with HTTP 409. For recovery,
page `/v1/feed` without `after`, process/deduplicate the available history, and resume
streaming from the resulting cursor. Starting streaming without a cursor intentionally
skips old history, so it is not a missed-report recovery procedure.

## Timing and operating limits

The server checks the durable feed approximately once per second per open connection.
This targets low latency **after publication**, not one second after the on-field event.
API-Football availability, collection intervals, queues, database and consumer delays
still contribute. This is not a verified end-to-end latency guarantee or provider push.

Connections rotate after approximately 20 seconds for bounded serverless execution.
Slow readers and stalled dependencies are bounded; interrupted clients replay their
last processed cursor. A Redis lease allows at most three concurrent streams per API
client across instances; each instance admits at most 48 opening/active streams.
Handshakes also consume existing API/auth rate limits. Authorization is rechecked
approximately every five seconds while flowing; it is not instantaneous revocation.
Abandoned leases expire after 60 seconds. Redis admission failures fail closed.

Before production rollout: ensure function duration is at least 60 seconds, verify
actual streaming through the deployed proxy, and test disconnect/reconnect and latency
under expected concurrent client load. Per-connection database polling is an initial
bounded implementation, not an unlimited fan-out service. Larger scale should use a
shared wake-up/fan-out layer while retaining the durable cursor feed as source of truth.
Track publish-to-delivery latency, active streams, 429/503 rates, database load and retries.

This endpoint emits existing published content reports, not every raw provider field
or fixture snapshot. Additional activity types must enter the canonical event and
publication pipeline to become streamable. Admin league controls govern ingestion;
historical published reports remain replayable when a league is later paused.

## Local verification

API and integration suite: 41 tests passed. The loopback HTTP test used disposable
PostgreSQL and Redis resources: authenticated streaming delivered a new publication,
reconnection replayed a report created while disconnected without repeating the
previous report, and revocation stopped the resumed stream. Concurrent Redis
admission accepted three of six attempts, then admitted a replacement after release.
Protocol tests covered framing, cursor validation, rotation, checkpoints and failures;
adapter tests confirmed invocation lifetime follows response completion/disconnect.
API/dependency build, TypeScript and targeted lint checks passed. Test containers were
stopped with their volumes retained. No production deployment or real alerts were sent.
