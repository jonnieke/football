# Source-event reviews

This is a conservative hold-and-review policy, not automatic event correction.
Provider semantic keys can change when the provider edits minute, team, player,
or goal classification. A new key must not silently become another goal when
the evidence also fits a revision.

Ingestion records pending reviews atomically with the snapshot/outbox for:

- Multiple entries sharing one source key in an observation.
- A new key replacing a missing historical event from the same event family.
  Goal/own-goal/penalty-goal/missed-penalty share a family; explicit VAR
  cancellations remain independent facts. Retained history covers empty-poll gaps.
- A new source event whose preceding legacy snapshot has no event observation.

The first post-upgrade poll also checks retained observations before setting
the fixture's review-policy version. Existing published rows are not rewritten
or withdrawn by this scan. Only future publication is gated.

Pending and dismissed keys remain held across polls, restarts, and old draft
checkpoints. Unambiguous events and lifecycle/score observations can continue.
The canonical persistence path checks the hold again under the same fixture
review lock used by ingestion, so replay cannot bypass it.

## Operator commands

Use a trusted operator environment with access to the intended database. These
are database administration commands, not public partner API endpoints. The
operator label is an audit statement, not a separate authentication mechanism.

```text
pnpm source:review list
pnpm source:review show <review-UUID>
pnpm source:review publish-one <review-UUID> <operator> <reason>
pnpm source:review dismiss <review-UUID> <operator> <reason>
```

`list` shows the oldest 100 pending reviews. `show` includes the immutable first
observation, possible predecessors, all colliding occurrences, and decision.
Check authoritative match evidence before deciding.

`publish-one` confirms that ONE stored event should be published as a distinct
fact. It does not infer the number of identical occurrences, merge identities,
or rewrite a previous event. The decision, player resolution, canonical event,
and content outbox commit together; failure rolls them all back. Retrying an
already-applied decision is idempotent. Concurrent decisions serialize and a
conflicting final decision is rejected. `dismiss` suppresses this key and keeps
its evidence; it does not withdraw previously published content.

Never publish a revised scorer as a second goal merely to clear a review. Keep
it held or dismiss it with a reason; an explicit linked editorial-correction and
withdrawal workflow remains future work. Missing events alone do not prove a
cancellation. A review does not automatically clear when a later poll looks normal.

## Rollout and limits

Drain/stop existing workers, back up the intended database, apply
`20260909000000_source_event_reviews`, rebuild, and start the same version across
ingestion/event/content/dispatcher services. Inspect pending reviews after the
first polls. Do not run mixed versions: old workers do not enforce review holds.

This policy deliberately favors review over guessing. An unrelated later event
can be held if an older event of the same family vanished. A provider that keeps
both the original and edited entries may look like two legitimate events; this
cannot be resolved reliably without more source evidence. Histories predating
stored observations cannot be reconstructed. The history scan runs only when
source events change or the review policy is first applied; long-lived fixtures
still need the planned observation-retention/indexing work.
