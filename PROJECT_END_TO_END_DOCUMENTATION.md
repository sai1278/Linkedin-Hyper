# LinkedIn-Hyper-V: End-to-End Project Documentation

## 1. Document Control
- Project: LinkedIn-Hyper-V
- Version: 1.1
- Last Updated: April 14, 2026
- Environment: Dockerized self-hosted deployment (frontend + worker + redis + postgres)
- Primary Repository: `main` branch
- Operations Runbook: `OPERATIONS_RUNBOOK.md`

## 2. Executive Summary
LinkedIn-Hyper-V is a self-hosted multi-account LinkedIn automation and operations dashboard. It supports account session management via cookies, session verification, live message sending, unified inbox/connections views, and activity tracking. The platform uses a Next.js frontend (port 3000) and a Node.js worker API (port 3001) coordinated through Redis and BullMQ.

The system is currently running with validated end-to-end flow for:
1. Session verification
2. Message sending
3. Manual and scheduled sync
4. Unified inbox visibility from both worker API and frontend API

## 3. Business Scope and Objectives
The project is designed to:
1. Operate multiple LinkedIn account sessions in one dashboard
2. Send and track outreach messages without third-party SaaS dependency
3. Keep inbox and connection data synchronized across accounts
4. Provide observable operational health for daily usage
5. Maintain secure, private, server-side session handling

## 4. Core Functional Capabilities
1. Multi-account management (`ACCOUNT_IDS` based)
2. Cookie import and encrypted session persistence
3. Verify account session against LinkedIn authenticated state
4. Send message to profile URL (`send-new` flow)
5. Unified inbox aggregation
6. Unified connections aggregation
7. Activity feed and stats per account
8. Manual sync trigger API
9. Retry and fallback behavior for transient browser failures

## 5. System Architecture
## 5.1 Components
1. Frontend service
- Framework: Next.js
- Port: `3000`
- Role: Dashboard UI + BFF (`/api/*`) routes

2. Worker service
- Runtime: Node.js + Express + Playwright
- Port: `3001` (internal)
- Role: Browser automation, sync orchestration, message actions, unified APIs

3. Redis service
- Role: Queue backend, rate-limit counters, activity logs, session state cache
- Auth: password protected

4. Postgres service
- Role: durable conversation/message storage for unified views

## 5.2 Data Flow (Message Send to Inbox Visibility)
1. Client calls `POST /api/messages/send-new`
2. Frontend forwards to worker `/messages/send-new`
3. Worker executes browser-driven send operation
4. Worker writes activity log entry (`messageSent`)
5. Worker persists optimistic conversation/message state for immediate visibility
6. Unified inbox endpoint merges DB + activity and deduplicates
7. Client reads `GET /api/inbox/unified` and sees latest sent message

## 6. API Surface
## 6.1 Frontend/BFF Endpoints (`:3000/api`)
1. `POST /api/accounts/{id}/verify`
2. `POST /api/messages/send-new`
3. `GET /api/inbox/unified`
4. `GET /api/connections/unified`
5. `GET /api/stats/{accountId}/activity`
6. `POST /api/sync/messages`

## 6.2 Worker Endpoints (`:3001`, internal)
1. `POST /accounts/{id}/verify`
2. `POST /messages/send-new`
3. `GET /inbox/unified`
4. `GET /connections/unified`
5. `GET /accounts`
6. `POST /sync/messages`

## 7. Security and Controls
1. Worker API authentication via `X-Api-Key` (`API_SECRET`) for internal server-to-worker traffic only
2. Public Next.js `/api/*` routes require either a valid dashboard session cookie or `Authorization: Bearer <API_ROUTE_AUTH_TOKEN>`
3. CSRF/origin protection is enforced on state-mutating BFF routes
4. `/api/auth/login` is rate-limited by client IP using Redis with in-memory fallback
5. Worker-side account and conversation validation rejects unknown `accountId` values and cross-account `chatId` usage before queueing jobs
6. Encrypted session handling uses `SESSION_ENCRYPTION_KEY`
7. Redis password authentication is required
8. Docker production compose binds `worker:3001` and `frontend:3000` to `127.0.0.1` by default for reverse-proxy-only exposure
9. Request timeouts and controlled error responses are used for operational safety

## 7.1 Mandatory Go-Live Actions
1. Rotate all previously committed secrets immediately: `DB_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD`, `API_SECRET`, `API_ROUTE_AUTH_TOKEN`, `SESSION_ENCRYPTION_KEY`, dashboard password
2. Remove `.env` from version control and keep only `env.example` in the repository
3. Purge exposed secrets from Git history if this repository has been shared externally
4. Expose only Nginx/reverse-proxy ports publicly; do not publish `3001`
5. Store production secrets only in the server `.env` / secret manager, never in PowerShell runbooks or markdown examples

## 8. Deployment Model
## 8.1 Services
1. `frontend`
2. `worker`
3. `redis`
4. `postgres`

## 8.2 Standard Deploy Command
```bash
make deploy
```

## 8.2.1 Secret Generation (Before First Production Deploy)
```bash
openssl rand -hex 16   # DB_PASSWORD
openssl rand -hex 32   # API_SECRET
openssl rand -hex 32   # SESSION_ENCRYPTION_KEY
openssl rand -base64 48 | tr -d '\n'   # JWT_SECRET
openssl rand -base64 48 | tr -d '\n'   # API_ROUTE_AUTH_TOKEN
openssl rand -base64 24 | tr -d '\n'   # REDIS_PASSWORD / DASHBOARD_PASSWORD
```

## 8.3 Health Validation
```bash
make status
make logs
```

## 8.4 Full Deploy (Server Commands)
```bash
cd ~/Linkedin-Hyper
git checkout main
git pull --ff-only origin main

docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build --force-recreate worker frontend

docker compose ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --since=10m worker frontend | tail -n 200
```

## 9. Operations Runbook
## 9.1 Daily Startup Validation
1. Run automated validation:
```bash
make status
```
2. Open the dashboard status page:
```text
/status
```

## 9.2 Laptop Validation (Public API Path)
```powershell
$base = "http://<server-ip>:3000/api"
$token = $env:LINKEDIN_HYPER_ROUTE_AUTH_TOKEN
if (-not $token) { throw "Set LINKEDIN_HYPER_ROUTE_AUTH_TOKEN before running public /api checks" }
Invoke-RestMethod -Method Post -Uri "$base/sync/messages" -Headers @{ Authorization = "Bearer $token" }
curl.exe -sS -H "Authorization: Bearer $token" "$base/inbox/unified?limit=10"
```

## 9.3 Cookie Refresh Procedure
1. Delete account session
2. Capture/import fresh cookies
3. Verify session endpoint
4. Re-run send/sync tests

Server-side session cleanup:
```bash
KEY="$(grep -E '^API_SECRET=' .env | cut -d= -f2-)"
curl -s -X DELETE -H "X-Api-Key: $KEY" "http://127.0.0.1:3001/accounts/kanchidhyanasai/session"
curl -s -X DELETE -H "X-Api-Key: $KEY" "http://127.0.0.1:3001/accounts/saikanchi130/session"
```

Laptop-side cookie import + verify:
```powershell
cd "C:\Users\kanchiDhyana sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V"
$base = $env:LINKEDIN_HYPER_BASE_URL
$token = $env:LINKEDIN_HYPER_ROUTE_AUTH_TOKEN

if (-not $base) { throw "Set LINKEDIN_HYPER_BASE_URL to your public app URL, for example https://app.example.com/api" }
if (-not $token) { throw "Set LINKEDIN_HYPER_ROUTE_AUTH_TOKEN before calling the public /api routes" }

.\import-cookies.ps1 -AccountId kanchidhyanasai -AutoCapture -Browser chrome -CaptureProfile "Profile 12" -CaptureTimeoutSec 600 -CookieFile ".\cookies-kanchi.json" -BaseUrl $base -RouteAuthToken $token
.\import-cookies.ps1 -AccountId saikanchi130    -AutoCapture -Browser chrome -CaptureProfile "Profile 24" -CaptureTimeoutSec 600 -CookieFile ".\cookies-sai.json"   -BaseUrl $base -RouteAuthToken $token

Invoke-RestMethod -Method Post -Uri "$base/accounts/kanchidhyanasai/verify" -Headers @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post -Uri "$base/accounts/saikanchi130/verify"    -Headers @{ Authorization = "Bearer $token" }
```

## 10. Reliability Enhancements Implemented
1. Added frontend route: `POST /api/sync/messages`
2. Added optimistic persistence for `send-new` results
3. Unified inbox now merges DB-backed and activity-backed conversations
4. Deduplication logic improved for account/name/profile combinations
5. Low-signal `fallback-*` rows are suppressed when high-signal rows exist
6. Activity feed deduplication and size capping implemented

## 11. Observability and Diagnostics
## 11.1 Key Logs
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --since=15m worker | tail -n 300
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --since=15m frontend | tail -n 200
```

## 11.2 Important Error Patterns
1. `AUTHENTICATED_STATE_NOT_REACHED`: session/login flow incomplete, re-import cookies
2. `Operation failed`: transient automation failure or stale session
3. `SESSION_EXPIRED` or `NO_SESSION`: cookie/session invalid
4. Redis `NOAUTH`: use configured Redis password

Redis auth debug commands:
```bash
REDIS_PASSWORD="$(grep -E '^REDIS_PASSWORD=' .env | cut -d= -f2-)"
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env exec -T redis sh -lc "redis-cli -a \"$REDIS_PASSWORD\" PING"
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env exec -T redis sh -lc "redis-cli -a \"$REDIS_PASSWORD\" LLEN activity:log:saikanchi130"
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env exec -T redis sh -lc "redis-cli -a \"$REDIS_PASSWORD\" LRANGE activity:log:saikanchi130 0 5"
```

## 12. Known Constraints and Notes
1. LinkedIn automation is sensitive to session quality and anti-automation checks
2. Account IDs are internal system slots, not guaranteed to match display name
3. Occasional transient browser protocol warnings may occur without hard failure
4. Consistent cookie quality is critical for stable verify/send behavior

## 13. Current Status (As of April 14, 2026)
1. Deployment successful on server
2. Worker and frontend healthy
3. Sync trigger operational on both worker and frontend API paths
4. Unified inbox now returns clean activity-backed conversations
5. End-to-end message visibility issue resolved

## 14. Suggested Next Improvements
1. Add external alert delivery (email/Slack) for critical session/sync issues
2. Add one-click restore helpers for Postgres and Redis backups
3. Add signed release tagging to simplify rollback refs
4. Add backup retention cleanup policy for `backups/`

## 15. Handover Summary
The platform is operational and validated for production-style daily usage with current account sessions. Message send and inbox visibility are functioning end-to-end, sync trigger is available through public API path, and major inbox noise issues have been addressed with dedupe and fallback suppression logic.

## 16. End-to-End Command Runbook (Copy/Paste Ready)
## 16.1 Server: Verify Current Build
```bash
cd ~/Linkedin-Hyper
git branch --show-current
git rev-parse --short HEAD
docker compose ps
```

## 16.2 Server: Trigger Sync and Validate Inbox
```bash
KEY="$(grep -E '^API_SECRET=' .env | cut -d= -f2-)"
curl -s -X POST -H "X-Api-Key: $KEY" "http://127.0.0.1:3001/sync/messages"
curl -s -H "X-Api-Key: $KEY" "http://127.0.0.1:3001/inbox/unified?limit=10"
curl -s -H "X-Api-Key: $KEY" "http://127.0.0.1:3001/connections/unified?limit=10"
```

## 16.3 Laptop: Trigger Public API Sync + Check Inbox
```powershell
$base = $env:LINKEDIN_HYPER_BASE_URL
$token = $env:LINKEDIN_HYPER_ROUTE_AUTH_TOKEN

Invoke-RestMethod -Method Post -Uri "$base/sync/messages" -Headers @{ Authorization = "Bearer $token" }
curl.exe -sS -H "Authorization: Bearer $token" "$base/inbox/unified?limit=10"
curl.exe -sS -H "Authorization: Bearer $token" "$base/connections/unified?limit=10"
```

## 16.4 Laptop: Real Live Message Test
```powershell
$base = $env:LINKEDIN_HYPER_BASE_URL
$token = $env:LINKEDIN_HYPER_ROUTE_AUTH_TOKEN

$sendBody = @{
  accountId  = "saikanchi130"
  profileUrl = "https://www.linkedin.com/in/pasala-jaswanth-kumar-reddy/"
  text       = "LIVE test $(Get-Date -Format o)"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post -Uri "$base/messages/send-new" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $sendBody
Invoke-RestMethod -Method Post -Uri "$base/sync/messages" -Headers @{ Authorization = "Bearer $token" }
curl.exe -sS -H "Authorization: Bearer $token" "$base/inbox/unified?limit=10"
```

## 16.5 Dual-Account Smoke Test (Laptop Script)
```powershell
cd "C:\Users\kanchiDhyana sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V"
$base = $env:LINKEDIN_HYPER_BASE_URL
$token = $env:LINKEDIN_HYPER_ROUTE_AUTH_TOKEN

.\test-dual-accounts.ps1 `
  -BaseUrl $base `
  -RouteAuthToken $token `
  -AccountIds "kanchidhyanasai,saikanchi130" `
  -ProfileUrl "https://www.linkedin.com/in/pasala-jaswanth-kumar-reddy/" `
  -CookieFileMapJson '{"kanchidhyanasai":"cookies-kanchi.json","saikanchi130":"cookies-sai.json"}'
```

## 16.6 Log Monitoring (Server)
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --since=15m worker | tail -n 300
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --since=15m frontend | tail -n 200
```

## 16.7 Fast Incident Recovery (Server)
```bash
cd ~/Linkedin-Hyper
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build --force-recreate worker frontend
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --since=10m worker frontend | tail -n 200
```
