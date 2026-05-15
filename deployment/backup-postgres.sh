#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${1:-.env}"
OUTPUT_DIR="${2:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE")

mkdir -p "$OUTPUT_DIR"

OUT_FILE="${OUTPUT_DIR}/postgres-${TIMESTAMP}.sql.gz"
echo "Creating Postgres backup: ${OUT_FILE}"
"${COMPOSE[@]}" exec -T postgres pg_dump -U linkedinuser -d linkedin_db | gzip > "$OUT_FILE"
echo "Done."
