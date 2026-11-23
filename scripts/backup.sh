#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

TARGET_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$TARGET_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$TARGET_DIR/miniflux-$STAMP.sql.gz"

echo "Đang sao lưu Postgres vào $OUT_FILE..."
docker compose exec -T db pg_dump -U miniflux -d miniflux --clean --if-exists | gzip > "$OUT_FILE"

# Giữ tối đa 14 bản sao lưu gần nhất
ls -1t "$TARGET_DIR"/miniflux-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "✓ Sao lưu hoàn tất: $OUT_FILE"
