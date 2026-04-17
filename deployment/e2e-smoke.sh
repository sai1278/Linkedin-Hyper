#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
BASE_URL="http://127.0.0.1:3001"
PROFILE_URL=""
ACCOUNT_ID=""
TEXT="Hi, test message from automation"

read_env_value() {
  local key="$1"
  local env_file="${2:-$ENV_FILE}"
  local value=""

  value="${!key:-}"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return
  fi

  if [[ -f "$env_file" ]]; then
    value="$(grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- || true)"
    printf '%s' "$value"
  fi
}

usage() {
  cat <<'EOF'
Usage:
  bash deployment/e2e-smoke.sh --profile-url <linkedin-profile-url> [--account-id <id>] [--text <message>]

Example:
  bash deployment/e2e-smoke.sh \
    --profile-url "https://www.linkedin.com/in/pasala-jaswanth-kumar-reddy/" \
    --account-id "kanchidhyanasai"
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile-url)
      PROFILE_URL="${2:-}"
      shift 2
      ;;
    --account-id)
      ACCOUNT_ID="${2:-}"
      shift 2
      ;;
    --text)
      TEXT="${2:-}"
      shift 2
      ;;
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-.env}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PROFILE_URL" ]]; then
  echo "Missing --profile-url"
  usage
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

API_KEY="$(read_env_value API_SECRET)"
ROUTE_AUTH_TOKEN="$(read_env_value API_ROUTE_AUTH_TOKEN)"
IS_FRONTEND_API=0
if [[ "$BASE_URL" == */api || "$BASE_URL" == */api/ ]]; then
  IS_FRONTEND_API=1
fi

if [[ "$IS_FRONTEND_API" -eq 1 && -z "$ROUTE_AUTH_TOKEN" ]]; then
  echo "Missing API_ROUTE_AUTH_TOKEN for public /api usage."
  exit 1
fi

if [[ "$IS_FRONTEND_API" -eq 0 && -z "$API_KEY" ]]; then
  echo "Missing API_SECRET. Set it in $ENV_FILE or the shell environment."
  exit 1
fi

if [[ -z "$ACCOUNT_ID" ]]; then
  ACCOUNT_ID="$(grep -E '^ACCOUNT_IDS=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | cut -d, -f1 | xargs || true)"
fi

if [[ -z "$ACCOUNT_ID" ]]; then
  echo "Could not resolve ACCOUNT_ID. Pass --account-id explicitly."
  exit 1
fi

call_api() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local headers=()
  if [[ -n "$API_KEY" ]]; then
    headers+=(-H "X-Api-Key: $API_KEY")
  fi
  if [[ -n "$ROUTE_AUTH_TOKEN" ]]; then
    headers+=(-H "Authorization: Bearer $ROUTE_AUTH_TOKEN")
  fi
  if [[ -n "$body" ]]; then
    curl -sS "${headers[@]}" -H "Content-Type: application/json" -X "$method" "$url" -d "$body"
  else
    curl -sS "${headers[@]}" -X "$method" "$url"
  fi
}

echo "1) Health"
curl -fsS "$BASE_URL/health"
echo
echo

echo "2) Verify session for account: $ACCOUNT_ID"
VERIFY_RESP="$(call_api POST "$BASE_URL/accounts/$ACCOUNT_ID/verify" || true)"
echo "$VERIFY_RESP"
if [[ "$VERIFY_RESP" != *"\"ok\":true"* ]]; then
  echo
  echo "E2E blocked: session is not active. Re-import LinkedIn cookies, then retry."
  exit 2
fi
echo

echo "3) Send message to: $PROFILE_URL"
SAFE_TEXT="${TEXT//\"/\\\"} (E2E $(date -u +%Y-%m-%dT%H:%M:%SZ))"
PAYLOAD="{\"accountId\":\"$ACCOUNT_ID\",\"profileUrl\":\"$PROFILE_URL\",\"text\":\"$SAFE_TEXT\"}"
SEND_RESP="$(call_api POST "$BASE_URL/messages/send-new" "$PAYLOAD" || true)"
echo "$SEND_RESP"
if [[ "$SEND_RESP" == *"\"error\""* ]]; then
  echo
  echo "Message send failed. Check error above (connection status / messageability / session)."
  exit 3
fi
echo

echo "4) Unified inbox quick check"
INBOX_RESP="$(call_api GET "$BASE_URL/inbox/unified?limit=20" || true)"
echo "$INBOX_RESP"
echo
echo "E2E smoke completed."
