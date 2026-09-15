#!/bin/sh
set -eu

name=fcp-supabase-backup
if docker ps -a --format '{{.Names}}' | grep -Fx "$name" >/dev/null; then
  echo 'Backup container already exists; refusing to replace it.' >&2
  exit 1
fi

test -f /var/lib/fcp/worker.env
test -f /var/lib/fcp/supabase-ca.crt
test -d /var/lib/fcp/backups

docker run -d --name "$name" --restart unless-stopped \
  --memory=512m --pids-limit=128 --cap-drop=ALL \
  --security-opt=no-new-privileges --read-only \
  --tmpfs=/tmp:rw,noexec,nosuid,size=16m \
  --log-opt max-size=10m --log-opt max-file=3 \
  --mount type=bind,source=/var/lib/fcp/worker.env,target=/run/secrets/worker.env,readonly \
  --mount type=bind,source=/var/lib/fcp/supabase-ca.crt,target=/run/secrets/supabase-ca.crt,readonly \
  --mount type=bind,source=/var/lib/fcp/backups,target=/var/lib/fcp/backups \
  --env BACKUP_BUCKET=fcp-supabase-backups-ball-mtaani-496717 \
  fcp-supabase-backup:2026-09-15
