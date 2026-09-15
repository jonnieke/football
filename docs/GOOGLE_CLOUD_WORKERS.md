# Google Cloud football workers — live rollout, 2026-09-15

The four football workers run continuously on Compute Engine VM `fcp-workers-1`
in project `ball-mtaani-496717`, zone `us-central1-a`. The Vercel API and admin
site continue to use the same Supabase database and Aiven Redis as the workers.
Only Premier League 39 / season 2026 is enabled at this rollout. The match email
sender is not running.

## Deployment and controls

- Machine: `e2-small`, two shared vCPUs / 2 GiB memory, Container-Optimized OS,
  20 GiB standard boot disk, automatic VM restart and live migration enabled.
- Dedicated `fcp-workers-vpc` and `fcp-workers-us-central1` subnet. The only
  inbound rule allows SSH from Google's IAP range to the `fcp-worker` tag.
  Workers have outbound internet access; no application ports are exposed.
- The VM now has `fcp-backup-uploader@ball-mtaani-496717.iam.gserviceaccount.com`
  with the storage read/write OAuth scope, but IAM grants only
  `roles/storage.objectCreator` on the private backup bucket. It cannot read
  or delete bucket objects. OS Login and Shielded VM secure boot are enabled.
  Operator SSH uses `--tunnel-through-iap`.
- The exact local Linux image was `fcp-workers:2026-09-15-quiet-fix`. Its
  compiled database SHA256 is
  `2c0ca06795d36eff99b1a1f997676092448a8f2e247c4e9fa767806beb3b0705`.
  The transfer archive SHA256 is
  `fa86ec4b23741eccbdc6d8acab52444cce238ba2f4ff52f1d386b554ed160b5b`.
- Docker containers: `fcp-event-processor`, `fcp-content-generator`,
  `fcp-outbox-dispatcher`, `fcp-football-ingestion`. All use
  `--restart=unless-stopped`; the collector starts last. Their logs rotate at
  10 MiB × three files each. Node heap limit is 256 MiB per process.
- The source `.env.workers.local` was copied with specific owner approval over
  IAP, then moved to `/var/lib/fcp/worker.env` on the VM with mode `0400`, owner
  UID 1000 (the unprivileged container user). The Supabase CA is mounted
  read-only. Do not display, commit, or copy the credential file into an image.
- `LIVE_POLL_INTERVAL_SECONDS=20`, zero API-Football retries and an 8-second
  request timeout override the original local test settings. The delay begins
  after each poll finishes, so start-to-start timing includes poll duration.
  The admin can change the enabled leagues; request volume rises with tracked
  fixtures and must be watched against the shared API-Football allowance.
- Monthly alert budget: `$25 USD`, filtered to this whole Google project,
  thresholds 50%, 80% and 100%. This is an alert, not a spending cap, and can
  include other project usage. VM, external IPv4 and disk are estimated around
  $17/month at 730 hours before taxes, data transfer and other project usage.

## Initial verification

All nine Supabase migration checksums matched before startup. The preflight
found three fixtures, 16 events, 16 content items and zero pending outbox work;
no worker signals or ingestion lock were active. The image passed Linux
OpenSSL/Node 24, worker-file, secret-exclusion and corrected-code hash checks.
The VM container check parsed the private credentials without network access or
printing values.

At 2026-09-15 14:22 UTC, three successive cloud polls succeeded, each returning
three unchanged fixtures. All four containers and Redis heartbeats were active.
The Vercel API `/v1/health` returned HTTP 200 with every service healthy.
Container memory at first check was approximately 104, 70, 38 and 38 MiB;
the VM had about 1.3 GiB available. No fresh football event occurred during
this check, so field-event-to-publication and subscriber latency remain
unmeasured. Automatic publication of eligible fresh events was verified in
isolated integration tests before rollout.

A repeat check at 14:25 UTC still returned HTTP 200 healthy. The latest three
saved polls all succeeded with three unchanged fixtures, all four heartbeats
were present, pending outbox work was zero, and content/feed counts were
unchanged. Match email deliveries and opted-in match recipients were both zero.

## Operator access

Use the admin dashboard's read-only operations view for database, queue,
worker and provider signals. The public API health endpoint is
`https://api-1lc3.vercel.app/v1/health`. A recent heartbeat confirms activity,
not that every job succeeded.

For technical operators, use `gcloud compute ssh fcp-workers-1` with
`--zone=us-central1-a`, `--project=ball-mtaani-496717`,
`--account=limitedmobipesa@gmail.com` and `--tunnel-through-iap`. On the VM,
`sudo docker ps` shows the four containers; `sudo docker logs` and the latest
database polling records help diagnose failures. Stop or restart a named
container deliberately; changing the VM or image without a release plan can
interrupt live capture. The launch script at `/var/lib/fcp/launch-workers.sh`
refuses to replace an existing container.

## Backup preparation, 2026-09-15

Supabase Free does not provide scheduled backups. A private Google Cloud Storage
bucket `fcp-supabase-backups-ball-mtaani-496717` was created in the US
multi-region with public access prevention, uniform bucket-level access,
Standard storage, 30-day lifecycle deletion and seven-day soft delete. The
backup-only VM service account has create-only bucket IAM and no downloaded
key. Attaching it required a VM stop/start; there were no tracked fixtures
within four hours of the maintenance window. All four workers restarted and
the public API health endpoint again reported every service healthy.

The dedicated Postgres 17 backup image reads the existing private worker
environment and CA from read-only mounts, exports only the `public` schema,
and uploads a dated custom-format dump. The first local dump at 19:51 UTC
(94,527 bytes) restored in an isolated, network-disabled Postgres container:
21 tables, three fixtures, 16 football events and 16 content items.

Automatic security review initially stopped the first cloud export. The owner
then explicitly approved daily uploads of the production application database
from this VM to this named private bucket. The first off-site upload succeeded
at 20:07 UTC:

- Object:
  `dsholtmeyivyjwiuzedb/application-2026-09-15T20-07-36-325Z.dump`
- Generation: `1789502869522794`; size: 95,525 bytes.
- SHA-256: `d6c2b3d60e1fe655f910a901b8d6c81469b58b9a5df45191409f9dfb3c106634`.
- The cloud-reported MD5 matched the uploader's local MD5. An independent
  bucket download matched the SHA-256, then restored into a network-disabled
  Postgres container with 21 tables, three fixtures, 16 events and 16 content
  items. The downloaded verification copy is at
  `D:/software/football-private-backups/offsite-restore-check-2026-09-15T20-07-36-325Z.dump`.

Container `fcp-supabase-backup` now runs alongside the four football workers
with `--restart=unless-stopped`, a 512 MiB memory cap, read-only root and
credential mounts, a two-copy local staging limit, rotating logs, and a health
check that becomes unhealthy if the last successful remote upload is over
36 hours old. The scheduled daily backup is 03:00 UTC (06:00 Nairobi time).
Today's verified upload suppresses a duplicate at container startup. The
first **scheduled** run is due 2026-09-16 03:00 UTC and has not yet been
observed. The final image ID is
`sha256:9aac5afb5b899aa57cd746c2339d0ee557306a13dc14736527a9bd4e6ea245b8`.
The live API remained healthy with all four worker signals after startup.

## Remaining production work

- Confirm the first 2026-09-16 scheduled backup actually uploads, then inspect
  the container's health periodically. Google Monitoring has a successful
  `WriteObject`/`OK` metric for this bucket. A tested PromQL expression detects
  no successful write over 27 hours; a five-minute test window returned the
  expected missing-write signal and the 27-hour window remained quiet after
  the actual upload. The owner explicitly authorized Google Cloud Monitoring
  to send project/bucket/backup-status alerts, without database contents, to
  `kariukinjoroge13@gmail.com`. The email channel
  `projects/ball-mtaani-496717/notificationChannels/16396414057389261869`
  and policy
  `projects/ball-mtaani-496717/alertPolicies/8215949838916987364` are now
  enabled. The policy is valid, evaluates every five minutes, notifies when no
  `WriteObject`/`OK` metric arrives for 27 hours, and repeats once daily while
  an incident is open. A read-back confirmed the exact Gmail recipient and
  query, and the live query currently has zero triggering series. The source
  policy is `docker/backup-missing-alert-policy.json`. Google Cloud Monitoring
  offers no direct test for email channels; actual Gmail delivery remains
  unverified until an incident occurs or an explicitly labeled test incident
  is arranged.
  Managed Supabase schemas, Storage files, global roles and
  project settings are not included in this application dump; a full Supabase
  disaster-recovery plan still needs those resources and a restore runbook.
- The worker image came from the dirty local working tree, not a committed Git
  release. Review and commit the intended changes, then plan image updates.
- No automatic email-alert sender or opted-in match recipients are active.
  The earlier Resend test was accepted, but inbox receipt is unconfirmed.
- Measure an actual new API-Football event through persistence, publication,
  Vercel stream and notification; no event occurred during the rollout checks.
- Watch daily API-Football quota as fixtures and selected leagues increase. The
  current interval is not a hard provider-request cap.
