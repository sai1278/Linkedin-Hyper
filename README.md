# LinkedIn Hyper-V

> Self-hosted, multi-account LinkedIn automation dashboard — no third-party SaaS, no LinkedIn API.  
> Real Google Chrome instances run inside Docker, driven by Playwright exactly like a human.

---

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
| `NEXT_PUBLIC_API_URL` | ✅ | `http://localhost:3001` | Client-side base URL |
| `PROXY_AUTH_TOKENS` | ✅ for proxy | — | JSON: `{"<token>":"user","<token>":"admin"}` |
| `API_ROUTE_AUTH_TOKEN` | ❌ | — | Bearer token to protect Next.js API routes |
| `PROXY_AUTH_COOKIE_NAME` | ❌ | `proxy_session` | Cookie name for proxy session |

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

- **Bearer token** auth via `Authorization` header (token defined in `PROXY_AUTH_TOKENS`)
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
