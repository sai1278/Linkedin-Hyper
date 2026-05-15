#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
worker_root="$repo_root/worker"
frontend_log="$repo_root/frontend_run.log"
worker_log="$worker_root/worker_run.log"
preexisting_db_password="${DB_PASSWORD:-}"
preexisting_linkedin_hyper_db_password="${LINKEDIN_HYPER_DB_PASSWORD:-}"

load_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  fi
}

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti tcp:"$port" || true)"
    if [[ -n "$pids" ]]; then
      kill -9 $pids 2>/dev/null || true
    fi
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
}

wait_http() {
  local url="$1"
  local timeout_sec="$2"
  local deadline=$((SECONDS + timeout_sec))
  while (( SECONDS < deadline )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

load_env_file "$repo_root/.env"
load_env_file "$repo_root/.env.local"

redis_host="${REDIS_HOST:-127.0.0.1}"
redis_port="${REDIS_PORT:-6379}"
redis_password="${REDIS_PASSWORD:-$(openssl rand -hex 18)}"
api_secret="${API_SECRET:-$(openssl rand -hex 32)}"
session_key="${SESSION_ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
account_ids="${ACCOUNT_IDS:-saikanchi130}"
db_host="${DB_HOST:-127.0.0.1}"
db_port="${DB_PORT:-${DB_HOST_PORT:-5432}}"

resolved_db_password="${DB_PASSWORD:-}"
if [[ -z "$resolved_db_password" && -n "$preexisting_db_password" ]]; then
  resolved_db_password="$preexisting_db_password"
fi
if [[ -z "$resolved_db_password" && -n "$preexisting_linkedin_hyper_db_password" ]]; then
  resolved_db_password="$preexisting_linkedin_hyper_db_password"
fi

resolved_database_url="${DATABASE_URL:-${POSTGRES_URL:-}}"

if [[ -n "$resolved_database_url" ]]; then
  database_url="$resolved_database_url"
else
  if [[ -n "$resolved_db_password" ]]; then
    database_url="postgresql://linkedinuser:${resolved_db_password}@${db_host}:${db_port}/linkedin_db"
  else
    database_url="postgresql://linkedinuser@${db_host}:${db_port}/linkedin_db"
  fi
fi

kill_port 3000
kill_port 3001

if [[ "${SKIP_PRISMA_PUSH:-0}" != "1" && -x "$worker_root/node_modules/.bin/prisma" ]]; then
  (
    cd "$worker_root"
    DATABASE_URL="$database_url" ./node_modules/.bin/prisma db push --schema=prisma/schema.prisma >/dev/null 2>&1 || true
  )
fi

: > "$frontend_log"
: > "$worker_log"

(
  cd "$repo_root"
  npm run dev >>"$frontend_log" 2>&1
) &

(
  cd "$worker_root"
  export DATABASE_URL="$database_url"
  export POSTGRES_URL="$database_url"
  export REDIS_HOST="$redis_host"
  export REDIS_PORT="$redis_port"
  export REDIS_PASSWORD="$redis_password"
  export API_SECRET="$api_secret"
  export SESSION_ENCRYPTION_KEY="$session_key"
  export ACCOUNT_IDS="$account_ids"
  export DISABLE_MESSAGE_SYNC="1"
  export DIRECT_VERIFY="1"
  export DIRECT_EXECUTION="1"
  export DISABLE_QUEUE="1"
  export BROWSER_HEADLESS="1"
  export BROWSER_USE_SYSTEM_CHROME="1"
  npm run start >>"$worker_log" 2>&1
) &

wait_http "http://127.0.0.1:3000" 90 || true
wait_http "http://127.0.0.1:3001/health" 90 || true

echo "Frontend : http://127.0.0.1:3000"
echo "Backend  : http://127.0.0.1:3001/health"
echo "Logs:"
echo "  Frontend -> $frontend_log"
echo "  Backend  -> $worker_log"
