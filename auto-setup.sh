#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

account_id="saikanchi130"
profile_url=""
text="Hi, test message from automation"
base_url="http://127.0.0.1:3001"
api_secret="${LI_COOKIE_API_SECRET:-${API_SECRET:-}}"
auto_capture="1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --account-id) account_id="$2"; shift 2 ;;
    --profile-url) profile_url="$2"; shift 2 ;;
    --text) text="$2"; shift 2 ;;
    --base-url) base_url="$2"; shift 2 ;;
    --api-secret) api_secret="$2"; shift 2 ;;
    --no-auto-capture) auto_capture="0"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$api_secret" ]]; then
  echo "Missing API secret. Set LI_COOKIE_API_SECRET/API_SECRET or pass --api-secret." >&2
  exit 1
fi

"$repo_root/start-dev.sh"

if [[ "$auto_capture" == "1" ]]; then
  LI_COOKIE_API_SECRET="$api_secret" "$repo_root/import-cookies.sh" --account-id "$account_id" --auto-capture --base-url "$base_url"
else
  LI_COOKIE_API_SECRET="$api_secret" "$repo_root/import-cookies.sh" --account-id "$account_id" --base-url "$base_url"
fi

if [[ -n "$profile_url" ]]; then
  LI_COOKIE_API_SECRET="$api_secret" "$repo_root/test-message.sh" --account-id "$account_id" --profile-url "$profile_url" --text "$text" --base-url "$base_url"
else
  echo "Skipping test message because no --profile-url was provided."
fi
