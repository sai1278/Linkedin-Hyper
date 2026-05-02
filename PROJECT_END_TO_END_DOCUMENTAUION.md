# LinkedIn-Hyper-V End-to-End Project Documentation

## 1. Purpose
This document is the point-to-point operational runbook for LinkedIn-Hyper-V.

Use it for:
1. pulling the latest code
2. deploying to the server
3. verifying frontend and worker health
4. testing send flow from LinkedIn-Hyper to actual LinkedIn
5. testing inbound sync from actual LinkedIn back into LinkedIn-Hyper
6. running the app safely in demo/production-style mode

---

## 2. Current Known-Good Setup

### 2.1 Active branch
```bash
feature/ui-polish-2026-04-17
```

### 2.2 Deploy rule
Always deploy the latest head of:
```bash
feature/ui-polish-2026-04-17
```

Verify it with:
```bash
git rev-parse --short HEAD
```

### 2.3 Current port mapping
1. Frontend: `3002`
2. Worker API: `3001`
3. Redis: internal
4. Postgres: internal

### 2.4 Current stable demo account
```text
saikanchi130
```

### 2.5 Current unstable account
```text
kanchidhyanasai
```

Keep this account excluded from bulk sync unless session stability is re-validated:
```bash
MESSAGE_SYNC_DISABLED_ACCOUNT_IDS=kanchidhyanasai
```

---

## 3. End-to-End Flow Summary

### 3.1 Outbound flow
1. User sends message from LinkedIn-Hyper UI
2. Frontend BFF calls `/api/messages/send-new`
3. Worker opens LinkedIn browser session and sends message
4. Worker writes activity log and persists thread/message state
5. UI thread updates and later sync confirms the real LinkedIn thread state

### 3.2 Inbound flow
1. User sends message directly from actual LinkedIn
2. LinkedIn-Hyper `Sync & Reload Inbox` calls `/api/sync/messages`
3. Worker reads LinkedIn inbox and thread messages
4. Worker saves fetched messages into Postgres
5. Worker emits websocket inbox update event
6. Frontend reloads `/api/inbox/unified` and `/api/messages/thread`
7. UI merges full thread history and shows the new inbound message

---

## 4. Deployment Commands

## 4.1 Pull latest code on server
```bash
cd ~/Linkedin-Hyper

git fetch target
git checkout feature/ui-polish-2026-04-17
git pull target feature/ui-polish-2026-04-17
git rev-parse --short HEAD
```

Expected:
1. branch is `feature/ui-polish-2026-04-17`
2. `git rev-parse --short HEAD` returns the latest pulled commit

## 4.2 Rebuild and restart frontend + worker
```bash
cd ~/Linkedin-Hyper

docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build --force-recreate frontend worker
```

## 4.3 Verify service state
```bash
cd ~/Linkedin-Hyper

docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --since=10m frontend worker | tail -n 250
```

Expected:
1. frontend running on `0.0.0.0:3002->3000/tcp`
2. worker running on `127.0.0.1:3001->3001/tcp`
3. no build errors

---

## 5. Environment Verification

## 5.1 Confirm frontend port
```bash
sudo ss -ltnp '( sport = :3002 )'
curl -I http://127.0.0.1:3002
```

Expected:
1. `3002` is listening
2. frontend responds
3. `/` may return `307` redirect to `/login`, which is normal

## 5.2 Confirm worker health
```bash
curl -s http://127.0.0.1:3001/health
```

Expected:
```json
{"status":"ok", ...}
```

## 5.3 Confirm bulk sync protection
```bash
grep '^MESSAGE_SYNC_DISABLED_ACCOUNT_IDS=' .env
```

Expected:
```bash
MESSAGE_SYNC_DISABLED_ACCOUNT_IDS=kanchidhyanasai
```

---

## 6. App Access

Open:
```text
http://139.59.98.240:3002
```

Recommended demo path:
1. login to dashboard
2. open Inbox
3. use `saikanchi130`
4. open conversation with `pasala jaswanth kumar reddy`

---

## 7. PowerShell API Setup

Run on Windows:
```powershell
cd "C:\Users\kanchiDhyana sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V"

$base = "http://139.59.98.240:3002/api"
$routeToken = "YOUR_ROUTE_TOKEN_HERE"
```

---

## 8. Manual Sync Commands

## 8.1 Sync stable account only
```powershell
Invoke-RestMethod -Method Post -Uri "$base/sync/messages" -Headers @{
  "Authorization" = "Bearer $routeToken"
} -ContentType "application/json" -Body '{"accountId":"saikanchi130"}'
```

Expected:
```text
Sync completed for account saikanchi130
```

## 8.2 Bulk sync
```powershell
Invoke-RestMethod -Method Post -Uri "$base/sync/messages" -Headers @{
  "Authorization" = "Bearer $routeToken"
}
```

Expected:
1. all configured accounts sync
2. `kanchidhyanasai` is skipped if disabled in `.env`

---

## 9. Send Message Test

## 9.1 Scripted send test
```powershell
cd "C:\Users\kanchiDhyana sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V"

$base = "http://139.59.98.240:3002/api"
$routeToken = "YOUR_ROUTE_TOKEN_HERE"

.\test-message.ps1 `
  -BaseUrl $base `
  -RouteAuthToken $routeToken `
  -AccountId saikanchi130 `
  -ProfileUrl "https://www.linkedin.com/in/pasala-jaswanth-kumar-reddy/" `
  -Text "LIVE SEND TEST $(Get-Date -Format o)"
```

Expected:
1. session verify passes
2. send succeeds
3. message appears in actual LinkedIn

## 9.2 Worker log verification
```bash
cd ~/Linkedin-Hyper
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs -f worker
```

Expected worker lines:
```text
[Worker:saikanchi130] Processing job ...: sendMessageNew
[Worker:saikanchi130] Job ... (sendMessageNew) completed
```

---

## 10. Inbound LinkedIn -> App Sync Test

## 10.1 Real test flow
1. Send a message from actual LinkedIn in the same chat
2. Return to LinkedIn-Hyper
3. Click `Sync & Reload Inbox`
4. Open the same conversation again if needed

## 10.2 Expected result
1. actual LinkedIn message gets fetched by worker
2. worker persists message into database
3. `/api/inbox/unified` returns conversation with message history
4. `/api/messages/thread` returns full thread history
5. UI shows inbound message without removing old messages

---

## 11. API Verification Commands

## 11.1 Unified inbox
```powershell
curl.exe -sS -H "Authorization: Bearer $routeToken" "$base/inbox/unified?limit=10"
```

Expected:
1. conversation array returned
2. each conversation includes latest preview
3. DB-backed messages are preserved for synced threads

## 11.2 Thread fetch
Replace `CHAT_ID` and `ACCOUNT_ID`:
```powershell
curl.exe -sS -H "Authorization: Bearer $routeToken" "$base/messages/thread?accountId=saikanchi130&chatId=CHAT_ID&refresh=1&limit=250"
```

Expected:
1. `items` array returned
2. full visible history returned
3. messages sorted by timestamp ascending

---

## 12. UI Demo Steps

## 12.1 Demo: app -> LinkedIn
1. Open Inbox in LinkedIn-Hyper
2. Select `pasala jaswanth kumar reddy`
3. Type message in composer
4. Send from UI
5. Show same message in actual LinkedIn

## 12.2 Demo: LinkedIn -> app
1. Send reply from actual LinkedIn
2. Come back to LinkedIn-Hyper
3. Click `Sync & Reload Inbox`
4. Show new message inside same thread
5. Refresh page once and confirm old history remains visible

---

## 13. Current Known Operational Truths

1. Outbound send is working for `saikanchi130`
2. Inbound sync now waits for completion in the manual account-scoped path
3. Unified inbox now uses persisted conversation messages instead of preview-only arrays
4. Thread refresh depth and dedup logic were hardened
5. If websocket still shows `Offline` or `Reconnecting`, manual sync path should still work
6. Direct deployment on `:3002` may still require better websocket route exposure for true live realtime behavior

---

## 14. Troubleshooting Commands

## 14.1 Frontend + worker recent logs
```bash
cd ~/Linkedin-Hyper
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --since=10m frontend worker | tail -n 300
```

## 14.2 Watch worker live
```bash
cd ~/Linkedin-Hyper
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs -f worker
```

## 14.3 Confirm current deployed commit
```bash
cd ~/Linkedin-Hyper
git rev-parse --short HEAD
```

## 14.4 Inspect frontend public port
```bash
sudo ss -ltnp '( sport = :3002 )'
```

## 14.5 Inspect worker local port
```bash
sudo ss -ltnp '( sport = :3001 )'
```

---

## 15. Important Worker Log Lines

Expected useful logs after the latest fixes:
```text
[readMessages:saikanchi130] fetched conversations=...
[MessageSync] Thread merge input accountId=... threadId=... incoming=...
[MessageSync] Thread persistence summary accountId=... threadId=... fetched=... existing=... inserted=... duplicatesSkipped=... final=...
[MessageSync] WebSocket event emitted accountId=... threadId=... newMessages=...
[API] Unified inbox returned conversations=... messages=...
[API] Manual sync awaiting completion for account saikanchi130
[API] Manual sync completed: ...
```

These logs help prove:
1. LinkedIn inbox was read
2. thread messages were fetched
3. DB inserts happened
4. duplicates were skipped safely
5. API returned full persisted state

---

## 16. Safe Operating Mode

Use:
1. `saikanchi130` for demo/testing/live verification
2. `kanchidhyanasai` only after session stability is re-validated

Do not re-enable unstable account without confirming:
1. session verify passes
2. 15-minute soak verify passes
3. sync remains stable

---

## 17. Final Acceptance Checklist

Mark complete only if all pass:

1. Frontend accessible on `3002`
2. Worker healthy on `3001`
3. `saikanchi130` session valid
4. Send from app appears in LinkedIn
5. Send from actual LinkedIn appears in app after sync
6. Refresh does not remove old messages
7. No duplicate message rows appear
8. Bulk sync safely skips disabled unstable accounts
