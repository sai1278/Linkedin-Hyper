# Architecture

## Overview
LinkedIn Hyper-V has two runtime layers:
1. Next.js frontend/BFF on port `3000`
2. Worker API + Playwright automation on port `3001`

The browser should talk to the frontend only. In Docker and production, the frontend forwards internal requests to the worker through `API_URL=http://worker:3001`, while browser code uses `NEXT_PUBLIC_API_URL=/api`.

## Main components
### Frontend / BFF
- Next.js App Router
- Dashboard auth (`/api/auth/*`)
- Service-token and session auth enforcement for `/api/proxy/*`
- Safe worker forwarding helpers in `lib/server/backend-api.ts`

### Worker
- Express API in `worker/src/index.js`
- Route modules under `worker/src/routes/*`
- Playwright browser/context manager in `worker/src/browser.js`
- Session store in `worker/src/session.js`
- Message sync services under `worker/src/services/*`
- Send flow modules under `worker/src/services/send/*`

### Data / infra
- Redis for rate limiting, queue state, cached session data, and activity logs
- PostgreSQL/Prisma for users, conversations, and messages
- Docker Compose for local/prod orchestration

## Request flows
### Dashboard login
1. User submits email + password
2. `/api/auth/login` loads the user from the database
3. bcrypt validates the password hash
4. JWT is signed with the user's real role and stored in `app_session`
5. `/api/auth/verify` rehydrates the current DB user from `session.userId`

### Cookie import and verification
1. Operator imports cookies through the worker or BFF route
2. Worker normalizes cookies and stores them encrypted
3. `/accounts/:id/verify` loads cookies into a fresh browser context
4. LinkedIn feed + messaging navigation confirm a usable member session

### Message send
1. Client hits `/messages/send-new`
2. Rate limiter validates daily/hourly/cooldown windows
3. Worker acquires the account lock and loads the session
4. Send flow resolves an existing thread or opens a composer fallback
5. Confirmation helpers verify message echo + persistence before quota burn
6. Activity/metrics are updated only after success

### Message sync
1. Scheduler or manual request starts `sync/messages`
2. DB circuit breaker checks availability before scrape-heavy work
3. Worker reads inbox/threads sequentially per account
4. Prisma repositories persist normalized conversations/messages
5. Health + metrics surfaces report queue, browser, DB, and Redis state

## Security model
- Dashboard auth is DB-backed and role-aware
- Production rejects legacy shared-password auth
- Service tokens prefer expiring SHA-256 hashes in `SERVICE_AUTH_TOKENS`
- Static tokens require `ALLOW_STATIC_SERVICE_TOKENS=true`
- Sensitive routes use origin checks and `Cache-Control: private, no-store`
- Session cookies are encrypted at rest

## Operational guardrails
- Browser contexts are account-locked and skip busy-context eviction
- Default browser cache limit is `10`
- DB scrape circuit breaker pauses LinkedIn scraping during DB degradation
- `/health` returns `503` when critical dependencies are unhealthy
- `/metrics` exposes queue depth, send counts, failures, and session-expiry signals
