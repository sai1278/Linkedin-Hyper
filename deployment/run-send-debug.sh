#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
ACCOUNT_ID=""
PROFILE_URL=""
TEXT="Hi, test message from automation"

usage() {
  cat <<'EOF'
Usage:
  bash deployment/run-send-debug.sh --profile-url <linkedin-profile-url> [--account-id <id>] [--text <message>] [--env-file .env]

Example:
  bash deployment/run-send-debug.sh \
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

if [[ -z "$ACCOUNT_ID" ]]; then
  ACCOUNT_ID="$(grep -E '^ACCOUNT_IDS=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | cut -d, -f1 | xargs || true)"
fi

if [[ -z "$ACCOUNT_ID" ]]; then
  echo "Could not resolve account id from $ENV_FILE. Pass --account-id."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin not found"
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE")

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="artifacts/send-debug-$TS"
mkdir -p "$OUT_DIR"

echo "Output directory: $OUT_DIR"
echo

echo "0) Ensure services are up (build worker/frontend)"
"${COMPOSE[@]}" up -d --build worker frontend > "$OUT_DIR/compose-up.txt" 2>&1 || {
  cat "$OUT_DIR/compose-up.txt"
  echo "Failed to start services."
  exit 1
}
echo "Services are up."
echo

echo "1) Services"
"${COMPOSE[@]}" ps | tee "$OUT_DIR/compose-ps.txt"
echo

echo "2) Patch presence check inside worker"
"${COMPOSE[@]}" exec -T worker sh -lc "grep -n 'message-button search attempt' /app/src/actions/sendMessageNew.js || true" | tee "$OUT_DIR/patch-check.txt"
echo

echo "3) Snapshot worker logs (before run)"
"${COMPOSE[@]}" logs --tail=1200 worker > "$OUT_DIR/worker-before.log" || true

echo "4) Run e2e smoke send"
set +e
bash deployment/e2e-smoke.sh \
  --profile-url "$PROFILE_URL" \
  --account-id "$ACCOUNT_ID" \
  --text "$TEXT" \
  --env-file "$ENV_FILE" > "$OUT_DIR/e2e.out" 2>&1
E2E_RC=$?
set -e
cat "$OUT_DIR/e2e.out"
echo

echo "5) Snapshot worker logs (after run)"
"${COMPOSE[@]}" logs --tail=1800 worker > "$OUT_DIR/worker-after.log" || true

grep -E "sendMessageNew:|NOT_MESSAGEABLE|SEND_NOT_CONFIRMED|SESSION_EXPIRED|screenshot saved|Processing job|Job .* failed|thread fallback|message-button search attempt|composer opened successfully" \
  "$OUT_DIR/worker-after.log" > "$OUT_DIR/worker-key.log" || true

echo "6) Key worker lines"
if [[ -s "$OUT_DIR/worker-key.log" ]]; then
  cat "$OUT_DIR/worker-key.log"
else
  echo "(No key lines matched. Check $OUT_DIR/worker-after.log)"
fi
echo

echo "7) Copy debug screenshots from worker container"
WORKER_CID="$("${COMPOSE[@]}" ps -q worker || true)"
mkdir -p "$OUT_DIR/screenshots"
if [[ -n "$WORKER_CID" ]]; then
  docker cp "${WORKER_CID}:/tmp/linkedin-hyper-debug/." "$OUT_DIR/screenshots" >/dev/null 2>&1 || true
fi

if find "$OUT_DIR/screenshots" -type f | grep -q .; then
  echo "Screenshots copied to: $OUT_DIR/screenshots"
else
  echo "No screenshots found in /tmp/linkedin-hyper-debug"
fi
echo

if [[ $E2E_RC -eq 0 ]]; then
  echo "DONE: E2E completed."
else
  echo "DONE WITH ERRORS: E2E failed with exit code $E2E_RC."
fi

echo "All debug artifacts are in: $OUT_DIR"
