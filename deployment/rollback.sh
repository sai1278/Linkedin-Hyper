#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REF="${1:-}"
ENV_FILE="${2:-.env}"

if [[ -z "$REF" ]]; then
  echo "Usage: bash deployment/rollback.sh <git-ref> [env-file]"
  echo "Example: bash deployment/rollback.sh main~1 .env"
  exit 1
fi

CHANGED_FILES="$(git status --porcelain --untracked-files=no | awk '{print $2}' | grep -v '^.env$' || true)"
if [[ -n "$CHANGED_FILES" ]]; then
  echo "Rollback aborted because the worktree has local changes outside .env:"
  echo "$CHANGED_FILES"
  exit 1
fi

git fetch --all --tags
git checkout "$REF"

docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build --force-recreate worker frontend

echo "Rollback complete."
echo "Current ref: $(git rev-parse --short HEAD)"
