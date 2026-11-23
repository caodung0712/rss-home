#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Cách dùng: bash scripts/restore.sh <duong-dan-file.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Không tìm thấy file sao lưu: $BACKUP_FILE"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "⚠️  Đang khôi phục cơ sở dữ liệu từ $BACKUP_FILE..."
docker compose stop miniflux
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | docker compose exec -T db psql -U miniflux -d miniflux
else
  docker compose exec -T db psql -U miniflux -d miniflux < "$BACKUP_FILE"
fi
docker compose start miniflux
echo "✓ Khôi phục hoàn tất!"
