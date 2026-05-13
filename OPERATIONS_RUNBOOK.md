# Operations Runbook

This runbook is for day-to-day operation of Linkedin-Hyper in local or production-like environments.

## Daily Operator Checklist
1. Confirm `frontend`, `worker`, `postgres`, and `redis` are healthy.
2. Check `/api/health/startup-validation` for warnings.
3. Confirm required accounts still have valid LinkedIn sessions.
4. Review worker/frontend logs for send, sync, or session warnings.
5. Run controlled sync for any account that looks stale.

## Key Operational Commands
### Health
```bash
curl -sS http://127.0.0.1:3001/health | python3 -m json.tool
curl -sS http://127.0.0.1:3002/api/health/startup-validation | python3 -m json.tool
curl -sS http://127.0.0.1:3002/api/health/summary | python3 -m json.tool
```

### Logs
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --tail=100 frontend
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --tail=100 worker
```

### Env verification
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env exec frontend printenv | grep -E "TRUSTED_ORIGINS|USER_ACCOUNT_ACCESS|INITIAL_ADMIN_EMAILS|NEXT_PUBLIC_API_URL|NEXT_PUBLIC_WS_URL"
```

## Cookie Capture, Import, And Refresh
### Capture cookies locally
```bash
npm run cookies:capture -- --accountId ACCOUNT_ID --browser chrome --captureProfile "Profile 24"
```

### Import cookies into the worker
```bash
npm run cookies:import -- --accountId ACCOUNT_ID --cookieFile artifacts/cookies/ACCOUNT_ID/linkedin-cookies-plain.json --baseUrl http://127.0.0.1:3001
```

### Verify imported cookies are usable
```bash
curl -sS -X POST http://127.0.0.1:3001/accounts/ACCOUNT_ID/verify \
  -H "x-api-key: $API_SECRET_VALUE" | python3 -m json.tool
```

Operational notes:
- never paste raw cookie values into tickets or chat
- if `li_at` or `JSESSIONID` are missing, re-capture and re-import
- capture cookies from the same environment/proxy path used for automation when possible

## Account Session Checks
### Session status
```bash
curl -sS http://127.0.0.1:3002/api/accounts/ACCOUNT_ID/session/status | python3 -m json.tool
```

### Delete a broken session
```bash
curl -sS -X DELETE http://127.0.0.1:3002/api/accounts/ACCOUNT_ID/session \
  -H "Authorization: Bearer PLACEHOLDER_ROUTE_TOKEN"
```
Use this only for controlled operator recovery flows. Prefer dashboard session auth when possible.

## Inbox Sync
### Trigger message sync through the worker
```bash
curl -sS -X POST http://127.0.0.1:3001/sync/messages \
  -H "x-api-key: $API_SECRET_VALUE" \
  -H "Content-Type: application/json" \
  --data-binary '{"accountId":"ACCOUNT_ID"}' | python3 -m json.tool
```

### Trigger sync through the frontend BFF
```bash
curl -sS -X POST http://127.0.0.1:3002/api/sync/messages \
  -H "Authorization: Bearer PLACEHOLDER_ROUTE_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary '{"accountId":"ACCOUNT_ID"}' | python3 -m json.tool
```

Notes:
- non-admin dashboard users must be mapped to the account they sync
- if a non-admin user has multiple assigned accounts, `accountId` is required
- repeated sync should be idempotent and must not create duplicate messages

## Message Send Validation
Use one controlled message only.

### Send through the app
```bash
curl -sS -X POST http://127.0.0.1:3002/api/messages/send-new \
  -H "Authorization: Bearer PLACEHOLDER_ROUTE_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary '{"accountId":"ACCOUNT_ID","profileUrl":"https://www.linkedin.com/in/TEST_PROFILE","text":"E2E local validation 2026-05-13T00:00:00Z"}' | python3 -m json.tool
```

### Validate thread after send
```bash
curl -sS "http://127.0.0.1:3002/api/messages/thread?accountId=ACCOUNT_ID&chatId=CHAT_ID&refresh=1&limit=250" \
  -H "Authorization: Bearer PLACEHOLDER_ROUTE_TOKEN" | python3 -m json.tool
```

## Metrics And Monitoring
### Worker metrics
```bash
curl -sS http://127.0.0.1:3001/metrics | python3 -m json.tool
```

### Account activity
```bash
curl -sS "http://127.0.0.1:3002/api/stats/ACCOUNT_ID/activity?page=0&limit=50" \
  -H "Authorization: Bearer PLACEHOLDER_ROUTE_TOKEN" | python3 -m json.tool
```

## Common Failures And Fixes
### API 403: Forbidden: no assigned account access
- confirm `USER_ACCOUNT_ACCESS` and `INITIAL_ADMIN_EMAILS` are set in `.env`
- verify the frontend container received them
- log out and log in again to refresh stale session role/email state
- inspect `/api/auth/verify` diagnostics for mapped account IDs

### Forbidden: Invalid Origin
- set `TRUSTED_ORIGINS=http://YOUR_SERVER_IP:3002,http://127.0.0.1:3002`
- verify the value is present in the frontend container
- rebuild/restart frontend after env changes

### COOKIES_MISSING
- re-capture cookies
- re-import cookies
- verify `li_at` and `JSESSIONID` exist in the captured file
- retry account verify

### LinkedIn redirect loop or checkpoint
- capture cookies again from the same machine/proxy path used by the worker
- do not bypass checkpoint or captcha
- wait until LinkedIn fully completes auth on the owned account

### Worker DB unhealthy
- inspect worker logs
- verify `DATABASE_URL`, `POSTGRES_URL`, and `DB_PASSWORD`
- confirm postgres container health
- verify schema/migrations are present in the running DB

### Git push rejected: fetch first
```bash
git pull --rebase target feature/ui-polish-2026-04-17
```
Resolve conflicts, then push again.

### GitHub Actions failing
- inspect the failing workflow file
- run local validation commands
- compare CI env assumptions against local env and docs

### Inbox old-message flash or scroll jump
- confirm the frontend is on the latest thread-state guard implementation
- verify selected conversation and active thread IDs stay aligned
- confirm auto-scroll is not firing on same-message re-renders

## Related Docs
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [SECURITY.md](SECURITY.md)
- [TESTING.md](TESTING.md)
- [SECURITY_ROTATION.md](SECURITY_ROTATION.md)
- [docs/COOKIE_REFRESH.md](docs/COOKIE_REFRESH.md)
- [docs/LOCAL_LINKEDIN_E2E_TESTING.md](docs/LOCAL_LINKEDIN_E2E_TESTING.md)
