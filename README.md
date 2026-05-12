# LinkedIn Hyper-V

> Self-hosted, multi-account LinkedIn automation dashboard — no third-party SaaS, no LinkedIn API.  
> Real Google Chrome instances run inside Docker, driven by Playwright exactly like a human.

---

## Canonical Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md)
- [SECURITY_ROTATION.md](./SECURITY_ROTATION.md)
- [MIGRATION_STATIC_TOKENS.md](./MIGRATION_STATIC_TOKENS.md)

## Current Auth Model

- Dashboard login uses registered **email + password** only.
- Passwords are stored as bcrypt hashes.
- Set `INITIAL_ADMIN_EMAILS` before first registration if you need bootstrap admin accounts.
- Use `USER_ACCOUNT_ACCESS` to assign specific LinkedIn `accountId` values to non-admin dashboard users when you want account-scoped access without giving admin privileges.
- In Docker production, the **frontend** container must receive `INITIAL_ADMIN_EMAILS`, `USER_ACCOUNT_ACCESS`, and `TRUSTED_ORIGINS`, because the Next.js `/api/*` routes enforce account access server-side and validate same-origin mutations there.
- Legacy shared dashboard passwords are deprecated and should not be used for production access.

## What It Does

| Feature | Details |
|---|---|
| **Unified Inbox** | Reads all messages from every LinkedIn account into one feed |
| **Send Messages** | Send to existing threads or open new conversations via profile URL |
| **Connection Requests** | Send requests with optional note, per-account rate limited |
| **Activity Feed** | Browse sent messages, connection requests, and profile views |
| **Session Cookies** | Import LinkedIn session cookies via curl — no password stored |
| **Rate Limiting** | Atomic per-account, per-action Redis counters with TTL |
| **Secure Proxy** | Role-based RBAC reverse proxy for external API access |

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, Tailwind CSS |
| Worker API | Node.js + Express |
| Browser Automation | Playwright + Google Chrome Stable |
| Job Queue | BullMQ on Redis |
| Session Store | Redis (AES-256-GCM encrypted cookies) |
| Orchestration | Docker Compose |

---

## Quick Start (5 Steps)

### 1. Clone and configure

```bash
git clone https://github.com/<your-username>/Linkedin-Hyper-V.git
cd Linkedin-Hyper-V
cp env.example .env
```

Edit `.env` — minimum required:

```env
SESSION_ENCRYPTION_KEY=   # openssl rand -hex 32
API_SECRET=               # any long random string
REDIS_PASSWORD=           # any long random string
ACCOUNT_IDS=              # comma-separated IDs e.g. alice,bob
```

### 2. Build and start

```bash
docker-compose up -d --build
```

### 3. Verify services are healthy

```bash
docker-compose ps       # all should show "healthy"
docker-compose logs -f worker
```

### 4. Import LinkedIn cookies

For each account (replace `alice` and your cookies):

```bash
curl -s -X POST http://localhost:3001/accounts/alice/session \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_SECRET" \
  -d '[{"name":"li_at","value":"AQE...","domain":".linkedin.com","path":"/","httpOnly":true,"secure":true},{"name":"JSESSIONID","value":"\"ajax:...\"","domain":".linkedin.com","path":"/","httpOnly":false,"secure":true}]'
```

Confirm:

```bash
curl -s http://localhost:3001/accounts/alice/session/status \
  -H "X-Api-Key: $API_SECRET"
# → {"exists":true,"accountId":"alice","savedAt":...}
```

### 5. Open the dashboard

Navigate to [http://localhost:3000](http://localhost:3000) →  
redirects to `/inbox` automatically.

---

## Environment Variables

### Frontend (`.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_SECRET` | ✅ | — | Shared secret between frontend and worker |
| `API_URL` | ✅ | `http://localhost:3001` | Internal URL of the worker API |
| `NEXT_PUBLIC_API_URL` | Yes | `/api` | Client-side base URL |
| `NEXT_PUBLIC_WS_URL` | No | - | Browser WebSocket URL, e.g. `ws://YOUR_SERVER_IP:3002/ws` |
| `TRUSTED_ORIGINS` | No | - | Comma-separated frontend origins allowed to perform cookie-authenticated POST/PUT/PATCH/DELETE requests, e.g. `http://YOUR_SERVER_IP:3002,http://127.0.0.1:3002` |
| `PROXY_AUTH_TOKENS` | No | - | Legacy static proxy tokens. Compatibility only. |
| `SERVICE_AUTH_TOKENS` | No | `[]` | Preferred expiring hashed service tokens for proxy/BFF automation |
| `INITIAL_ADMIN_EMAILS` | No | - | Comma-separated emails that should receive the `admin` role at registration |
| `USER_ACCOUNT_ACCESS` | No | - | JSON map of dashboard user email/userId to allowed LinkedIn `accountId` values |

Do not use the typoed names `NEXT_PUBLIC_API__URL` or `NEXT_PUBLIC_WS__URL`; they are not read by the app.

### Worker (`.env`)

| Variable | Required | Description |
|---|---|---|
| `SESSION_ENCRYPTION_KEY` | ✅ | 64 hex chars (AES-256-GCM key). Generate: `openssl rand -hex 32` |
| `API_SECRET` | ✅ | Must match frontend `API_SECRET` |
| `ACCOUNT_IDS` | ✅ | Comma-separated account IDs |
| `REDIS_HOST` | ✅ | Redis hostname (`redis` in Docker) |
| `REDIS_PORT` | ✅ | Redis port (default `6379`) |
| `REDIS_PASSWORD` | ✅ | Redis auth password |
| `PROXY_URL` | ❌ | HTTP proxy for Chrome: `http://user:pass@host:port` |

---

## Rate Limits (default)

| Action | Limit | Window |
|---|---|---|
| Messages sent | 20 / account | 24h |
| Connection requests | 15 / account | 24h |
| Inbox reads | 30 / account | 1h |
| Profile views | 40 / account | 24h |

Limits are enforced atomically in Redis before any browser action.

---

## Session Management

- Cookies are encrypted with **AES-256-GCM** with a fresh random IV per save.
- Cookies are re-saved after every successful action to extend their lifetime.
- Sessions are stored in Redis under `session:<accountId>` (encrypted).
- Delete a session: `DELETE /accounts/:accountId/session` with `X-Api-Key`.

---

## Proxy Layer

The Next.js frontend exposes `/api/proxy/[...path]` as an authenticated reverse proxy for external callers. Supports:

- **Bearer token** auth via `Authorization` header (`SERVICE_AUTH_TOKENS` preferred, `PROXY_AUTH_TOKENS` compatibility-only)
- **Cookie** auth via `PROXY_AUTH_COOKIE_NAME`
- **Role-based access control**: `user` can access read routes; `admin` can access all routes
- An allowlist of safe paths — requests outside the allowlist return 403

---

## Architecture

```
Browser
  └─ Next.js Frontend :3000
        ├─ /api/* → BFF route handlers
        └─ /api/proxy/* → RBAC reverse proxy

BFF routes
  └─ Worker Express API :3001
        ├─ BullMQ job → worker.js dispatcher
        │     ├─ verifySession / readMessages / readThread
        │     ├─ sendMessage / sendMessageNew
        │     ├─ sendConnectionRequest / searchPeople
        │     └─ humanBehavior (mouse, typing, scroll)
        └─ browser.js (Chrome Pool via Playwright)
              └─ Google Chrome Stable (headless=false + Xvfb)

Redis :6379
  ├─ BullMQ queues
  ├─ Rate limit counters  (INCR + TTL)
  ├─ Session cookies      (AES-256-GCM)
  └─ Activity logs        (LPUSH, capped at 1000)
```

---

## Hard Constraints

| Rule | Reason |
|---|---|
| **BullMQ concurrency = 1** | Parallel sessions trigger LinkedIn bans |
| **headless = false + Xvfb** | Headless Chrome is fingerprinted and blocked |
| **Google Chrome Stable only** | Chromium lacks the fingerprint of a real user browser |
| **AES-256-GCM with fresh IV** | Never store cookies in plaintext |
| **Rate limit before any action** | Ensures limits are atomic and can't be raced |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Chrome crashes on startup | `shm_size: 1gb` must be set in compose; check with `docker inspect` |
| Xvfb fails | Ensure worker entrypoint sets `DISPLAY=:99` before node |
| `NO_SESSION` error | Cookie is missing or expired — re-import with curl |
| `RATE_LIMIT` error | Account hit its daily action cap — wait for TTL to expire |
| `Backend unreachable` in UI | Worker container not healthy — `docker-compose logs worker` |
| Redis auth errors | Verify `REDIS_PASSWORD` matches `--requirepass` in compose |

---

## Local Scripts

### Bash

```bash
./start-dev.sh
LI_COOKIE_API_SECRET='<set in shell>' ./import-cookies.sh --account-id alice --base-url http://127.0.0.1:3001
LI_COOKIE_API_SECRET='<set in shell>' ./test-message.sh --account-id alice --profile-url https://www.linkedin.com/in/example/
```

### PowerShell

```powershell
.\start-dev.ps1
.\import-cookies.ps1 -AccountId alice -BaseUrl http://127.0.0.1:3001
.\test-message.ps1 -AccountId alice -ProfileUrl https://www.linkedin.com/in/example/
```

### Automated Checks

```bash
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm test
```

See [MIGRATION_STATIC_TOKENS.md](./MIGRATION_STATIC_TOKENS.md) for the static-to-expiring token migration plan.


