#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${1:-.env}"
OUTPUT_DIR="${2:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE")

mkdir -p "$OUTPUT_DIR"

OUT_FILE="${OUTPUT_DIR}/redis-${TIMESTAMP}.tar.gz"
echo "Creating Redis backup: ${OUT_FILE}"
"${COMPOSE[@]}" exec -T redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" BGSAVE >/dev/null 2>&1 || true; sleep 2; tar -czf - -C /data .' > "$OUT_FILE"
echo "Done."
