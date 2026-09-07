# Event model

Normalized events use the controlled taxonomy in `packages/football-core`.
Captured source observations independently detect goals, own goals, penalty
goals, missed penalties, red/second-yellow cards, and explicit VAR goal
cancellations. Minute cutoffs are not used: late source events remain eligible.

Score increases produce `score_updated`; decreases produce `score_correction`.
These describe the aggregate scoreboard observation, not an invented goal or
scorer. A source goal and a scoreboard update can both be published. Partners
must accept the new `score_updated` event type. Source event alerts without an
event-time score show the match pairing, never a later fixture score.

Lifecycle transitions emit the current observed status. On first sight only
that status is emitted: discovering a finished match does not fabricate its
kickoff/halftime timeline. Observation IDs distinguish repeated corrections
and status transitions. Processing order is not yet guaranteed to match match
chronology; commit-ordered feed publication is the next remediation stage.

API-Football does not supply an event ID in this adapter's event payload. The
v2 semantic key contains source fixture, type, minute, added time, team, and
player. It excludes response index, display names, comments, and score. Its
canonical fingerprint uses only fixture, type, and source key. Reordering and
name updates therefore cannot republish an event. Exact legacy positional IDs
are recognized without rewriting existing ledger rows.

Corrections to identity fields and indistinguishable duplicate occurrences now
have a conservative [source-review workflow](SOURCE_REVIEWS.md). Suspected
replacements and duplicate keys are held for an explicit operator decision;
they are never automatically merged. Legacy state-generated goals still cannot
be safely linked to subsequently supplied player events. Drain legacy work
before rollout; review historical replay separately.

The ledger remains append-oriented. Explicit cancellations and scoreboard
corrections do not guess a related goal from recency. Removal from an upstream
array alone is not proof of cancellation. Existing content is not rewritten.
