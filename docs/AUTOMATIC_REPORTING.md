# Automatic real-time reporting — agreed direction

Goal: unattended API-Football ingestion, automatic fresh-event publication and
configured notifications, with admin selection of leagues/seasons. Human review
is not the normal reporting path. This supersedes the mandatory approval plan.

## Current implementation

Admin controls, database migrations and partner streaming were deployed on
2026-09-15. Persistent worker hosting remains pending; see
[release evidence](RELEASE_2026-09-15.md). Local worker trials are bounded and
are not a continuously running production service.

Fresh eligible content is inserted as published in the same transaction that
completes its durable work. The existing feed-sequence trigger and unique event/
channel/type key preserve ordering and deduplication. No approval record or user
session is required. Retries do not modify existing content or refresh eligibility.

Trusted observation provenance is carried through checkpointed events into the
durable content-work JSON. It is NOT inferred from draft creation or canonical
detection time. No database schema change is required. Existing drafts and legacy
work without provenance remain unpublished; nothing bulk-publishes old items.

Initial freshness policy:

- A prior distinct, source-aware observation must exist. The preceding successful
  persisted poll of that fixture must be within 120 seconds. Its timestamp is
  frozen as `previousObservedAt` in the changed observation's durable outbox payload.
  Legacy work without this field uses the preceding snapshot's capture time.
- Newly observed source incidents must not be in the preceding observation and
  must be within two match minutes of the current clock. Source incidents in
  completed/cancelled/abandoned/postponed matches are withheld.
- Fresh observed state transitions, including full-time and scoreboard corrections,
  may publish automatically even when the new state is finished.
- Publication must happen within 120 seconds of that original observation, never
  before it; invalid clocks fail closed. The league must be enabled.

This is a conservative freshness heuristic, not an assertion of exact event UTC
time or guaranteed first reporting. First imports and recovery after long gaps
establish a baseline without replaying historical events as breaking alerts.
Snapshots are saved on changes. Successful unchanged polls update the fixture's
existing `lastPolledAt` without adding snapshots or work. The next changed
observation copies that preceding timestamp under the fixture writer lock; event
preparation never reads the mutable current poll timestamp. Invalid timestamps,
baselines preceding the prior snapshot, bootstrap and gaps over 120 seconds fail
closed. A failed fetch/persistence does not advance that fixture's continuity.
An unchanged successful poll after an outage establishes a new baseline; historical
source IDs already captured there remain excluded from fresh reporting.
Provider minute granularity (especially stoppage time), late
corrections, and outages still need real-world acceptance testing.

Suppressed content currently uses the existing draft storage and optional manual
publication tool; it does not block subsequent live work or require manual approval
for routine fresh events. The local dashboard describes this as historical/withheld
content. Existing ambiguous-source identity review holds are unchanged; their
automatic reconciliation is separate work, not claimed complete here.

## Remaining work and rollout

1. Admin league/season controls are deployed; see [League controls](LEAGUE_CONTROLS.md).
2. Dashboard auto-updates and the partner stream are deployed. Consumers must still
   integrate the stream. The email sender is implemented but remains stopped.
3. Continuous worker hosting, quotas, reconnect/restart and latency verification.
4. Roll out the matching ingestion, dispatcher and event-processing builds together.
   The quiet-poll fix passed local tests and a bounded live run of the rebuilt workers;
   continuous hosting and live new-event delivery verification remain pending.
   Old work/prepared checkpoints are not refreshed or backfilled. Verify the policy
   against actual live events; local tests do not establish event-delivery latency.

## Quiet-poll fix verification — 2026-09-15

No schema migration or production data update required. Disposable PostgreSQL tests
verified twenty unchanged 30-second polls produce no extra snapshots/work, a new goal
then becomes published automatically, and ten-minute outage catch-up remains withheld
after later successful polls and a stale writer retry. Durable work timestamps remain
unchanged. Existing observation and approval integration regressions passed (7 tests
across 3 files). Unit checks cover invalid/future timestamps, bootstrap, outages,
source-event age and publication expiry. Typechecking and targeted ESLint passed.
Full non-integration regression suite: 271 passed, 32 skipped. The seven integration
checks above ran separately rather than being counted as verified by the skipped suite.
Test containers were stopped with volumes retained; no live provider or email calls.

The old live smoke-test configuration uses 300-second polling, incompatible with
the 120-second continuity window. Do not use it to validate unattended operation.
Old scripts described as draft-only are NOT evidence that rebuilt workers cannot
publish. Every future live run must explicitly account for automatic publication.
