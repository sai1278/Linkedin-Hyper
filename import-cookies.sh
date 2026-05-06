#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

account_id=""
cookie_file=""
auto_capture="0"
base_url="http://127.0.0.1:3001"
api_secret="${LI_COOKIE_API_SECRET:-${API_SECRET:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --account-id) account_id="$2"; shift 2 ;;
    --cookie-file) cookie_file="$2"; shift 2 ;;
    --auto-capture) auto_capture="1"; shift ;;
    --base-url) base_url="$2"; shift 2 ;;
    --api-secret) api_secret="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$account_id" ]]; then
  echo "Usage: ./import-cookies.sh --account-id <id> [--cookie-file path] [--auto-capture] [--base-url url] [--api-secret value]" >&2
  exit 1
fi

if [[ -z "$api_secret" ]]; then
  echo "Missing API secret. Set LI_COOKIE_API_SECRET/API_SECRET or pass --api-secret." >&2
  exit 1
fi

cd "$repo_root"

if [[ "$auto_capture" == "1" ]]; then
  npm run cookies:refresh-direct -- --accountId "$account_id" --baseUrl "$base_url" --apiSecret "$api_secret"
  exit $?
fi

if [[ -z "$cookie_file" ]]; then
  cookie_file="$repo_root/artifacts/cookies/$account_id/linkedin-cookies-plain.json"
fi

npm run cookies:import -- --accountId "$account_id" --cookieFile "$cookie_file" --baseUrl "$base_url" --apiSecret "$api_secret"
