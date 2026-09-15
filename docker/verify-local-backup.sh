#!/bin/sh
set -eu

archive=$1
name="fcp-backup-restore-check-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run -d --name "$name" --network none --memory 512m \
  --tmpfs /var/lib/postgresql/data:rw,size=256m,mode=1777 \
  --mount type=bind,source=/var/lib/fcp/backups,target=/backups,readonly \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null

ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" -eq 1 ] || { echo 'RESTORE_DATABASE_NOT_READY'; exit 1; }

docker exec "$name" createdb -U postgres restore_check
docker exec "$name" psql -X -U postgres -d restore_check -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA public' >/dev/null
docker exec -u 0 "$name" pg_restore -U postgres --dbname=restore_check \
  --no-owner --no-privileges --exit-on-error "/backups/$archive"
docker exec "$name" psql -X -U postgres -d restore_check -A -t \
  -v ON_ERROR_STOP=1 \
  -c "select 'tables=' || (select count(*) from pg_tables where schemaname='public') || ', fixtures=' || (select count(*) from public.fixtures) || ', events=' || (select count(*) from public.football_events) || ', content=' || (select count(*) from public.content_items)"
