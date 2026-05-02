#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${1:-.env}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}"
  exit 1
fi

KEY="$(grep -E '^[[:space:]]*API_SECRET[[:space:]]*=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r')"
if [[ -z "$KEY" ]]; then
  echo "API_SECRET is missing in ${ENV_FILE}"
  exit 1
fi

echo "== Compose Status =="
"${COMPOSE[@]}" ps
echo

echo "== Worker Health =="
curl -fsS "http://127.0.0.1:3001/health"
echo
echo

echo "== Health Summary =="
curl -fsS -H "X-Api-Key: $KEY" "http://127.0.0.1:3001/health/summary"
echo
echo

echo "== Startup Validation =="
curl -fsS -H "X-Api-Key: $KEY" "http://127.0.0.1:3001/health/startup-validation"
echo
