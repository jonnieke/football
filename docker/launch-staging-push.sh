#!/bin/bash
set -euo pipefail

IMAGE="${FCP_WORKER_IMAGE:-fcp-workers:2026-09-25-staging-push}"
PRIVATE_DIR="${FCP_PRIVATE_DIR:-/var/lib/fcp}"
ENV_FILE="$PRIVATE_DIR/worker.env"
CA_FILE="$PRIVATE_DIR/supabase-ca.crt"
STAGING_CA_FILE="$PRIVATE_DIR/staging-mysql-ca.crt"

if [[ "${1:-}" != "--check" && "${1:-}" != "--start" ]]; then
  echo "Usage: launch-staging-push.sh --check|--start" >&2
  exit 2
fi

test -r "$ENV_FILE"
test -r "$CA_FILE"
docker image inspect "$IMAGE" >/dev/null

MOUNTS=(
  --mount "type=bind,src=$ENV_FILE,dst=/secrets/worker.env,readonly"
  --mount "type=bind,src=$CA_FILE,dst=/secrets/supabase-ca.crt,readonly"
)
if [[ -f "$STAGING_CA_FILE" ]]; then
  MOUNTS+=(--mount "type=bind,src=$STAGING_CA_FILE,dst=/secrets/staging-mysql-ca.crt,readonly")
fi

docker run --rm --network none "${MOUNTS[@]}" "$IMAGE" \
  node --env-file=/secrets/worker.env -e '
    const target = new URL(process.env.STAGING_DATABASE_URL ?? "");
    if (process.env.STAGING_PUSH_ENABLED !== "true" ||
        target.protocol !== "mysql:" || !target.hostname ||
        !target.username || !target.password || target.pathname.length < 2)
      process.exit(1);
    console.log("Staging push target and credential format checks passed");
  '

if [[ "$1" == "--check" ]]; then
  exit 0
fi

if docker container inspect fcp-staging-push >/dev/null 2>&1; then
  echo "Refusing to replace existing container fcp-staging-push" >&2
  exit 1
fi

docker run --name fcp-staging-push \
  --detach --init --restart unless-stopped --stop-timeout 120 \
  --log-opt max-size=10m --log-opt max-file=3 \
  "${MOUNTS[@]}" \
  --env NODE_EXTRA_CA_CERTS=/secrets/supabase-ca.crt \
  "$IMAGE" node --env-file=/secrets/worker.env \
  workers/staging-push/dist/index.js >/dev/null
echo "Started fcp-staging-push"
