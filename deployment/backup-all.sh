#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${1:-.env}"
BASE_DIR="${2:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_DIR="${BASE_DIR}/${TIMESTAMP}"

mkdir -p "$TARGET_DIR"

bash deployment/backup-postgres.sh "$ENV_FILE" "$TARGET_DIR"
bash deployment/backup-redis.sh "$ENV_FILE" "$TARGET_DIR"

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "${TARGET_DIR}/env.backup"
  chmod 600 "${TARGET_DIR}/env.backup" || true
fi

echo "All backups written to ${TARGET_DIR}"
