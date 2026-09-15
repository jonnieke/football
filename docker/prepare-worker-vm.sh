#!/bin/bash
set -euo pipefail

SOURCE_DIR="/home/limitedmobipesa_gmail_com"
PRIVATE_DIR="/var/lib/fcp"

for file in worker.env prod-ca-2021.crt launch-workers.sh; do
  test -f "$SOURCE_DIR/$file"
  test ! -e "$PRIVATE_DIR/$file"
done

install -d -o root -g root -m 0711 "$PRIVATE_DIR"
mv "$SOURCE_DIR/worker.env" "$PRIVATE_DIR/worker.env"
chown 1000:1000 "$PRIVATE_DIR/worker.env"
chmod 0400 "$PRIVATE_DIR/worker.env"
install -o root -g root -m 0644 "$SOURCE_DIR/prod-ca-2021.crt" \
  "$PRIVATE_DIR/supabase-ca.crt"
install -o root -g root -m 0755 "$SOURCE_DIR/launch-workers.sh" \
  "$PRIVATE_DIR/launch-workers.sh"

stat -c '%n %a %u:%g' "$PRIVATE_DIR" \
  "$PRIVATE_DIR/worker.env" \
  "$PRIVATE_DIR/supabase-ca.crt" \
  "$PRIVATE_DIR/launch-workers.sh"
