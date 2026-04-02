#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"
ACCOUNTS_DEFAULT="${ACCOUNTS_DEFAULT:-kanchidhyanasai,saikanchi130}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin not found"
  exit 1
fi

touch "$ENV_FILE"

# Normalize .env and remove known bad line users accidentally add.
sed -i 's/\r$//' "$ENV_FILE"
sed -i '/^NewPassword123!=/d' "$ENV_FILE"

upsert() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

set_if_missing() {
  local key="$1"
  local value="$2"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo "${key}=${value}" >> "$ENV_FILE"
    return
  fi
  local current="${line#*=}"
  if [[ -z "${current// }" ]]; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  fi
}

PUBLIC_HOST="${PUBLIC_HOST:-}"
if [[ -z "$PUBLIC_HOST" ]]; then
  PUBLIC_HOST="$(curl -4 -fsS ifconfig.me 2>/dev/null || true)"
fi
if [[ -z "$PUBLIC_HOST" ]]; then
  PUBLIC_HOST="127.0.0.1"
fi

set_if_missing DB_PASSWORD "dev-db-pass-123"
set_if_missing ACCOUNT_IDS "$ACCOUNTS_DEFAULT"
set_if_missing API_SECRET "dev-api-secret-key-change-in-production"
set_if_missing REDIS_PASSWORD "dev-redis-pass-123"
set_if_missing SESSION_ENCRYPTION_KEY "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
set_if_missing DASHBOARD_PASSWORD "ChangeMeNow123!"
set_if_missing JWT_SECRET "mK9pL2qR8vX4nZ6wA1bC3dE5fG7hJ0kM9pL2qR8vX4nZ6wA1bC3dE5fG7hJ0kM"
set_if_missing SESSION_MAX_AGE "86400"

upsert FRONTEND_HOST_BIND "0.0.0.0"
upsert WORKER_HOST_BIND "127.0.0.1"
upsert DISABLE_MESSAGE_SYNC "1"
upsert DIRECT_VERIFY "1"

# Keep frontend talking to this server directly (no dead ngrok endpoints).
upsert NEXT_PUBLIC_API_URL "http://${PUBLIC_HOST}:3000"
upsert NEXT_PUBLIC_WS_URL "ws://${PUBLIC_HOST}:3000/ws"

echo "Validating compose config..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" config >/dev/null
echo "config OK"

echo "Rebuilding services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build --remove-orphans

echo
echo "Service status:"
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" ps

echo
echo "Health checks:"
curl -fsS http://127.0.0.1:3001/health && echo
curl -fsS -I http://127.0.0.1:3000 | head -n 1

echo
echo "Done. Public app URL: http://${PUBLIC_HOST}:3000"
