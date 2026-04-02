#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE")

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed"
  exit 1
fi

touch "$ENV_FILE"

# Cleanup known invalid line users often add by mistake.
sed -i '/^NewPassword123!=/d' "$ENV_FILE"

set_env() {
  local key="$1"
  local value="$2"
  if grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE"; then
    sed -i -E "s|^[[:space:]]*${key}[[:space:]]*=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

set_if_missing() {
  local key="$1"
  local value="$2"
  local line
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -n "$line" ]]; then
    local current
    current="$(echo "$line" | sed -E 's/^[[:space:]]*[^=]+=[[:space:]]*//')"
    if [[ -n "$current" ]]; then
      return 0
    fi
  fi
  set_env "$key" "$value"
}

# Core required env defaults.
set_if_missing DB_PASSWORD "dev-db-pass-123"
set_if_missing REDIS_PASSWORD "dev-redis-pass-123"
set_if_missing API_SECRET "q1W2e3R4t5Y6u7I8o9P0a1S2d3F4g5H6j7K8l9Z0x1C2v3B4"
set_if_missing SESSION_ENCRYPTION_KEY "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
set_if_missing DASHBOARD_PASSWORD "NewPassword123!"
set_if_missing JWT_SECRET "mK9pL2qR8vX4nZ6wA1bC3dE5fG7hJ0kM9pL2qR8vX4nZ6wA1bC3dE5fG7hJ0kM"
set_if_missing SESSION_MAX_AGE "86400"
set_if_missing ACCOUNT_IDS "kanchidhyanasai,saikanchi130"

# For direct IP/http login testing.
set_env COOKIE_SECURE "false"

DB_PASSWORD_VALUE="$(grep -E '^[[:space:]]*DB_PASSWORD[[:space:]]*=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
if [[ -z "$DB_PASSWORD_VALUE" ]]; then
  echo "DB_PASSWORD could not be resolved from .env"
  exit 1
fi
export DB_PASSWORD="$DB_PASSWORD_VALUE"

REDIS_PASSWORD_VALUE="$(grep -E '^[[:space:]]*REDIS_PASSWORD[[:space:]]*=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
if [[ -n "$REDIS_PASSWORD_VALUE" ]]; then
  export REDIS_PASSWORD="$REDIS_PASSWORD_VALUE"
fi

DATABASE_URL_VALUE="postgresql://linkedinuser:${DB_PASSWORD_VALUE}@postgres:5432/linkedin_db"
set_env DATABASE_URL "$DATABASE_URL_VALUE"
set_env POSTGRES_URL "$DATABASE_URL_VALUE"

echo "Validating compose..."
"${COMPOSE[@]}" config >/dev/null

echo "Ensuring frontend is exposed on 3000 publicly..."
if grep -q '127.0.0.1:3000:3000' docker-compose.prod.yml; then
  sed -i 's/127.0.0.1:3000:3000/3000:3000/' docker-compose.prod.yml
fi

echo "Stopping existing stack..."
"${COMPOSE[@]}" down || true

echo "Freeing local 3000..."
fuser -k 3000/tcp 2>/dev/null || true
docker rm -f $(docker ps -aq --filter "publish=3000") 2>/dev/null || true

echo "Starting base services..."
"${COMPOSE[@]}" up -d postgres redis
sleep 5

echo "Aligning DB password..."
DB_PASSWORD_SQL="${DB_PASSWORD_VALUE//\'/''}"
if ! "${COMPOSE[@]}" exec -T postgres sh -lc \
  "psql -v ON_ERROR_STOP=1 -U linkedinuser -d linkedin_db -c \"ALTER USER \\\"linkedinuser\\\" WITH PASSWORD '${DB_PASSWORD_SQL}';\"" >/dev/null 2>&1; then
  echo "Could not alter DB password. Recreating DB volume..."
  "${COMPOSE[@]}" down -v
  "${COMPOSE[@]}" up -d postgres redis
  sleep 5
fi

echo "Starting worker + frontend..."
"${COMPOSE[@]}" up -d --build worker frontend
sleep 8

echo "Applying Prisma schema..."
"${COMPOSE[@]}" exec -T worker npx prisma db push --schema=prisma/schema.prisma --url="$DATABASE_URL_VALUE"

echo
echo "Final status:"
"${COMPOSE[@]}" ps
echo
echo "Frontend check:"
curl -fsSI http://127.0.0.1:3000 | head -n 1
echo "Worker check:"
curl -fsS http://127.0.0.1:3001/health && echo

echo
echo "Self-heal completed."
