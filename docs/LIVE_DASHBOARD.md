# Automatically updating dashboard feed

Delivery order agreed with the owner: **dashboard → partner API consumers → email**.
The admin implementation was deployed on 2026-09-15; persistent workers remain stopped.
The second stage is documented in [Live partner API](LIVE_PARTNER_API.md); it is
not tied to one particular website or application.

The approved-admin control room checks `/api/live-feed` every five seconds while
visible. Published reports appear newest first with match, league, season, event
type, match minute, report text, publication time and kickoff time. Initial history
is labelled as history rather than announced as new events. Drafts are excluded.
Published manual historical reports are included, so publication time must never
be described as the event's occurrence time.

The reader uses the existing transactional publication sequence and epoch in a
bounded, read-only repeatable-read transaction. Initial load shows the latest 50;
subsequent pages read forward in batches of 50 without OFFSET. The browser keeps
up to 200 reports, deduplicates by content ID, and retains its cursor across retry
and display pause. A changed history epoch reloads recent history with a warning.
This admin-only cursor is a read position, not an authorization token; it cannot
bypass the approved session or select arbitrary query limits.

Only one browser request runs at a time, with an eight-second timeout. Errors
retain existing cards and display a stale-data warning, backing off to 30 seconds.
Session expiry redirects to sign-in. Hidden tabs suspend polling and resume when
visible. Display pause never changes league settings or stops workers.

Polling reads this admin deployment's database, not API-Football. Each active tab
adds about 12 admin requests per minute (720 per hour), plus other dashboard reads.
This is near-real-time display, not WebSocket push or a latency guarantee: provider,
worker, publication, network and browser scheduling delays all contribute. Large
catch-up backlogs take multiple five-second cycles. No browser/OS push notification,
sound, external webhook or email sender is enabled by this stage.

The league-controls migration and admin rollout are complete; worker rollout remains.
See [release evidence](RELEASE_2026-09-15.md). This feed adds no migration or new secrets.
No production changes or real match alerts were made during local verification.

Verification: approved-session and cursor-validation tests; simulated browser
polling, retry, deduplication, hidden-tab and display-pause tests; PostgreSQL tests
for fresh publication, latest-50 start, 55-item catch-up, empty polls and epoch reset.
Browser verification used disposable PostgreSQL data and the actual admin routes:
an automatically published simulated goal appeared without a page reload; replay
left one card; pause/resume worked; desktop/mobile layouts had no browser errors.
