#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

account_id=""
profile_url=""
text=""
base_url="http://127.0.0.1:3001"
api_secret="${LI_COOKIE_API_SECRET:-${API_SECRET:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --account-id) account_id="$2"; shift 2 ;;
    --profile-url) profile_url="$2"; shift 2 ;;
    --text) text="$2"; shift 2 ;;
    --base-url) base_url="$2"; shift 2 ;;
    --api-secret) api_secret="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$account_id" || -z "$profile_url" ]]; then
  echo "Usage: ./test-message.sh --account-id <id> --profile-url <linkedin-profile> [--text message] [--base-url url] [--api-secret value]" >&2
  exit 1
fi

if [[ -z "$api_secret" ]]; then
  echo "Missing API secret. Set LI_COOKIE_API_SECRET/API_SECRET or pass --api-secret." >&2
  exit 1
fi

if [[ -z "$text" ]]; then
  text="Hi, test message from automation $(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

payload="$(node -e "process.stdout.write(JSON.stringify({accountId:process.argv[1], profileUrl:process.argv[2], text:process.argv[3]}))" "$account_id" "$profile_url" "$text")"

curl -fsS -H "X-Api-Key: $api_secret" "$base_url/accounts/$account_id/session/status"
echo
curl -fsS -H "X-Api-Key: $api_secret" -X POST "$base_url/accounts/$account_id/verify"
echo
curl -fsS -H "X-Api-Key: $api_secret" -H "Content-Type: application/json" -X POST -d "$payload" "$base_url/messages/send-new"
echo
