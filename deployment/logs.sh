#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${1:-.env}"
SERVICE="${2:-}"
SINCE="${3:-15m}"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE")

if [[ -n "$SERVICE" ]]; then
  "${COMPOSE[@]}" logs -f --since="$SINCE" "$SERVICE"
else
  "${COMPOSE[@]}" logs -f --since="$SINCE" frontend worker redis postgres
fi
