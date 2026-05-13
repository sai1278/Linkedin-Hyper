# Deployment

This document covers production deployment for Linkedin-Hyper using Docker Compose.

## Production Topology
- `frontend` container: Next.js dashboard and `/api/*` BFF on port `3000` inside the container, typically exposed as host `3002`
- `worker` container: Express automation/runtime service on port `3001`
- `postgres` container: message and user persistence
- `redis` container: sessions, rate limits, caches, activity logs

Typical public exposure:
- frontend: `http://YOUR_SERVER_IP:3002`
- worker: internal only, or localhost-only if reverse proxied
- websocket: `ws://YOUR_SERVER_IP:3002/ws`

## Prerequisites
- Docker Engine with Compose support
- Git checkout of branch `feature/ui-polish-2026-04-17`
- A prepared `.env` file with placeholder values replaced by deployment values
- Managed LinkedIn account cookies captured/imported separately

## Required Environment Variables
Use placeholders only in source control.

```env
API_SECRET=change-me
JWT_SECRET=change-me
SESSION_ENCRYPTION_KEY=change-me
API_ROUTE_AUTH_TOKEN=change-me
REDIS_PASSWORD=change-me
DB_PASSWORD=change-me

ACCOUNT_IDS=saikanchi130
MESSAGE_SYNC_DISABLED_ACCOUNT_IDS=optional-account-id

NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP:3002
NEXT_PUBLIC_WS_URL=ws://YOUR_SERVER_IP:3002/ws
TRUSTED_ORIGINS=http://YOUR_SERVER_IP:3002,http://127.0.0.1:3002

INITIAL_ADMIN_EMAILS=admin@example.com
USER_ACCOUNT_ACCESS={"admin@example.com":["saikanchi130"]}

DATABASE_URL=postgresql://linkedinuser:DB_PASSWORD@postgres:5432/linkedin_db
POSTGRES_URL=postgresql://linkedinuser:DB_PASSWORD@postgres:5432/linkedin_db
REDIS_URL=redis://:REDIS_PASSWORD@redis:6379
```

## Important Env Wiring
The frontend container must receive:
- `TRUSTED_ORIGINS`
- `USER_ACCOUNT_ACCESS`
- `INITIAL_ADMIN_EMAILS`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_WS_URL`

The worker container must receive its runtime values for:
- `API_SECRET`
- `SESSION_ENCRYPTION_KEY`
- `ACCOUNT_IDS`
- database and Redis connection values
- optional `PROXY_URL`

Legacy typo names are wrong and should not be used:
- `NEXT_PUBLIC_API__URL`
- `NEXT_PUBLIC_WS__URL`

## Standard Deployment Flow
### 1. Update branch
```bash
git checkout feature/ui-polish-2026-04-17
git pull target feature/ui-polish-2026-04-17
```

### 2. Stop current containers
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env down
```

### 3. Rebuild and start
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build --force-recreate
```

### 4. Check running services
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env ps
```

## Health Verification
### Worker public health
```bash
curl -sS http://127.0.0.1:3001/health | python3 -m json.tool
```
Expected:
- `status: ok`
- `criticalDependencies.redis: true`
- `criticalDependencies.database: true`

### Frontend startup validation
```bash
curl -sS http://127.0.0.1:3002/api/health/startup-validation | python3 -m json.tool
```
Expected account access check:
- `id: account-access-config`
- `status: pass` or `warn`

### Frontend env propagation check
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env exec frontend printenv | grep -E "TRUSTED_ORIGINS|USER_ACCOUNT_ACCESS|INITIAL_ADMIN_EMAILS|NEXT_PUBLIC_API_URL|NEXT_PUBLIC_WS_URL"
```

## Log Inspection
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --tail=100 frontend
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --tail=100 worker
```

## Cookie / Session Deployment Tasks
After a fresh deploy or host migration:
1. confirm worker health
2. import cookies for each managed account
3. verify LinkedIn session
4. run a controlled sync

Example commands:
```bash
npm run cookies:capture -- --accountId ACCOUNT_ID --browser chrome --captureProfile "Profile 24"
npm run cookies:import -- --accountId ACCOUNT_ID --cookieFile artifacts/cookies/ACCOUNT_ID/linkedin-cookies-plain.json --baseUrl http://127.0.0.1:3001

curl -sS -X POST http://127.0.0.1:3001/accounts/ACCOUNT_ID/verify \
  -H "x-api-key: $API_SECRET_VALUE" | python3 -m json.tool
```

## Rebuild / Restart Recipes
### Rebuild only frontend
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build --force-recreate frontend
```

### Rebuild only worker
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build --force-recreate worker
```

### Restart all without rebuild
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env restart
```

## Rollback
If a deployment is unhealthy:
1. identify the last known-good commit
2. check out that commit or branch revision
3. rebuild containers from the known-good state
4. re-run health and auth verification
5. verify inbox and send/sync behavior before reopening access

Example:
```bash
git log --oneline -5
git checkout <KNOWN_GOOD_COMMIT>
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build --force-recreate
```

## Post-Deploy Smoke Checklist
- frontend page loads
- `/api/auth/verify` returns authenticated user after login
- `/api/health/startup-validation` shows expected account-access config
- `/api/inbox/unified` loads for an authorized account-scoped user
- `/api/messages/thread` opens a thread without stale-thread glitches
- `/api/sync/messages` succeeds for a controlled account

## Troubleshooting Shortcuts
### API 403: no assigned account access
- verify `USER_ACCOUNT_ACCESS` and `INITIAL_ADMIN_EMAILS` in the frontend container
- log out and log in again so the session role/email are current
- verify `/api/auth/verify` shows the expected email and effective role

### Forbidden: Invalid Origin
- verify `TRUSTED_ORIGINS`
- confirm it exists in the frontend container
- rebuild frontend if env values changed

### Worker DB unhealthy
- verify `DATABASE_URL` and `POSTGRES_URL`
- verify `DB_PASSWORD`
- inspect `postgres` container status and logs

See [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) and [SECURITY.md](SECURITY.md) for detailed response steps.
