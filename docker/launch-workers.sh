#!/bin/bash
set -euo pipefail

IMAGE="${FCP_WORKER_IMAGE:-fcp-workers:2026-09-15-quiet-fix}"
PRIVATE_DIR="${FCP_PRIVATE_DIR:-/var/lib/fcp}"
ENV_FILE="$PRIVATE_DIR/worker.env"
CA_FILE="$PRIVATE_DIR/supabase-ca.crt"

if [[ "${1:-}" != "--check" && "${1:-}" != "--start" ]]; then
  echo "Usage: launch-workers.sh --check|--start" >&2
  exit 2
fi

test -r "$ENV_FILE"
test -r "$CA_FILE"
docker image inspect "$IMAGE" >/dev/null

MOUNTS=(
  --mount "type=bind,src=$ENV_FILE,dst=/secrets/worker.env,readonly"
  --mount "type=bind,src=$CA_FILE,dst=/secrets/supabase-ca.crt,readonly"
)

# This check parses the private file inside the unprivileged runtime image. It
# does not open network connections or print credential values.
docker run --rm --network none "${MOUNTS[@]}" "$IMAGE" \
  node --env-file=/secrets/worker.env -e '
    const db = new URL(process.env.DATABASE_URL);
    const redis = new URL(process.env.REDIS_URL);
    if (!db.username.includes("dsholtmeyivyjwiuzedb") ||
        redis.protocol !== "rediss:" ||
        process.env.QUEUE_PREFIX !== "bull" ||
        process.env.API_FOOTBALL_BASE_URL !== "https://v3.football.api-sports.io" ||
        (process.env.CURSOR_SIGNING_SECRET ?? "").length < 32) process.exit(1);
    console.log("Worker target and credential format checks passed");
  '

if [[ "$1" == "--check" ]]; then
  exit 0
fi

COMMON=(
  --detach
  --init
  --restart unless-stopped
  --stop-timeout 120
  --log-opt max-size=10m
  --log-opt max-file=3
  "${MOUNTS[@]}"
  --env NODE_EXTRA_CA_CERTS=/secrets/supabase-ca.crt
  --env NODE_OPTIONS=--max-old-space-size=256
  --env LIVE_POLL_INTERVAL_SECONDS=20
  --env API_FOOTBALL_MAX_RETRIES=0
  --env API_FOOTBALL_TIMEOUT_MS=8000
)

start_worker() {
  local name="$1"
  local path="$2"
  if docker container inspect "$name" >/dev/null 2>&1; then
    echo "Refusing to replace existing container $name" >&2
    exit 1
  fi
  docker run --name "$name" "${COMMON[@]}" "$IMAGE" \
    node --env-file=/secrets/worker.env "$path" >/dev/null
  echo "Started $name"
}

start_worker fcp-event-processor workers/event-processor/dist/index.js
start_worker fcp-content-generator workers/content-generator/dist/index.js
start_worker fcp-outbox-dispatcher workers/outbox-dispatcher/dist/index.js
start_worker fcp-football-ingestion workers/football-ingestion/dist/index.js
