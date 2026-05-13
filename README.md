# Linkedin-Hyper

Linkedin-Hyper is a production-focused LinkedIn automation and unified inbox platform. It manages LinkedIn account sessions, verifies account health, syncs conversations into a searchable inbox, sends controlled messages through a worker service, and surfaces operational status through a Next.js dashboard.

The repository currently targets the `feature/ui-polish-2026-04-17` release line.

## Documentation
The project documentation is organized as an internal engineering documentation set for architecture review, deployment, operations, security, testing, and API reference. Start with the centralized index, then move into the focused guides for the area you are working on.

- Primary documentation hub: [DOCS_INDEX.md](DOCS_INDEX.md)
- System architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Production deployment: [DEPLOYMENT.md](DEPLOYMENT.md)
- Operations and runbook: [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)
- Security model and controls: [SECURITY.md](SECURITY.md)
- Test strategy and validation: [TESTING.md](TESTING.md)
- Swagger/OpenAPI guide: [SWAGGER_API.md](SWAGGER_API.md)
- OpenAPI specification: [docs/openapi.yaml](docs/openapi.yaml)

## What The App Does
- Runs a Next.js dashboard and API gateway for operators.
- Runs a worker service that owns LinkedIn browser automation, message sync, and send flows.
- Persists message and account state in PostgreSQL.
- Uses Redis for sessions, rate limits, caches, activity logs, and live inbox signaling.
- Streams inbox updates over WebSocket.
- Enforces dashboard auth, account ownership, same-origin mutation protection, and rate limiting.

## Core Capabilities
- Email/password dashboard login with bcrypt password validation.
- Admin and account-scoped operator access.
- LinkedIn cookie capture, import, verification, and session status checks.
- Unified inbox backed by database state with worker fallback when needed.
- Controlled message send flow using `/api/messages/send-new`.
- Conversation/thread export and activity export.
- Startup validation, health summary, metrics, and CI coverage.

## Tech Stack
- Frontend: Next.js App Router, React, TypeScript
- Worker: Node.js, Express, Playwright/Chromium
- Data: PostgreSQL, Redis
- Realtime: WebSocket
- Deployment: Docker Compose
- CI: GitHub Actions
- Tests: Vitest

## Repository Layout
```text
app/                      Next.js routes, dashboard pages, BFF API routes
components/               Inbox UI and shared components
lib/                      Auth, account access, DB access, backend forwarding, helpers
worker/                   Express worker, Playwright automation, queue, metrics, health
scripts/                  Cookie tooling, E2E helpers, OpenAPI validation
tests/                    Unit and security tests
docs/                     OpenAPI spec and focused operational docs
.github/workflows/        CI workflows
```

## Quick Start
### 1. Install dependencies
```bash
npm ci
```

### 2. Create your local env file
Copy `env.example` to `.env.local` for the frontend and `.env` for Compose-based local runs. Use placeholders only until you are ready to test with managed accounts.

Key placeholders:
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

### 3. Start local dependencies
```bash
docker compose up -d postgres redis
```

### 4. Start the worker and frontend
Use the repo helper scripts or separate terminals.

Frontend:
```bash
npm run dev
```

Worker:
```bash
cd worker
npm install
npm start
```

If you use the project startup helpers, see [DEPLOYMENT.md](DEPLOYMENT.md) and [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md).

## Common Validation Commands
```bash
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm test
npm run docs:openapi:validate
```

## Useful Runtime Commands
### Docker deployment
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env down
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build --force-recreate
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env ps
```

### Logs
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --tail=100 frontend
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs --tail=100 worker
```

### Health
```bash
curl -sS http://127.0.0.1:3001/health | python3 -m json.tool
curl -sS http://127.0.0.1:3002/api/health/startup-validation | python3 -m json.tool
```

### Env verification
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env exec frontend printenv | grep -E "TRUSTED_ORIGINS|USER_ACCOUNT_ACCESS|INITIAL_ADMIN_EMAILS|NEXT_PUBLIC_API_URL|NEXT_PUBLIC_WS_URL"
```

### Cookie capture/import
```bash
npm run cookies:capture -- --accountId ACCOUNT_ID --browser chrome --captureProfile "Profile 24"
npm run cookies:import -- --accountId ACCOUNT_ID --cookieFile artifacts/cookies/ACCOUNT_ID/linkedin-cookies-plain.json --baseUrl http://127.0.0.1:3001
```

### Account verify and sync
```bash
curl -sS -X POST http://127.0.0.1:3001/accounts/ACCOUNT_ID/verify \
  -H "x-api-key: $API_SECRET_VALUE" | python3 -m json.tool

curl -sS -X POST http://127.0.0.1:3001/sync/messages \
  -H "x-api-key: $API_SECRET_VALUE" \
  -H "Content-Type: application/json" \
  --data-binary '{"accountId":"ACCOUNT_ID"}' | python3 -m json.tool
```

## Local Development Notes
- The preferred browser-facing API base is `/api`.
- The preferred browser-facing WebSocket URL ends with `/ws`.
- Legacy typos are wrong and should not be used:
  - `NEXT_PUBLIC_API__URL`
  - `NEXT_PUBLIC_WS__URL`
- Real LinkedIn E2E testing is disabled by default.
- Use only test or owned LinkedIn accounts.

## Production Deployment Summary
Production is expected to run with:
- `frontend` container on port `3002`
- `worker` container on port `3001`
- reverse proxy or direct access configured for the frontend origin
- Docker Compose env propagation for `TRUSTED_ORIGINS`, `INITIAL_ADMIN_EMAILS`, `USER_ACCOUNT_ACCESS`, `NEXT_PUBLIC_API_URL`, and `NEXT_PUBLIC_WS_URL`

See [DEPLOYMENT.md](DEPLOYMENT.md) for step-by-step deployment and [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) for live operations.

## API And Swagger
- Main API documentation: [SWAGGER_API.md](SWAGGER_API.md)
- OpenAPI spec: [docs/openapi.yaml](docs/openapi.yaml)

## Additional Documentation
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)
- [SECURITY.md](SECURITY.md)
- [TESTING.md](TESTING.md)
- [SECURITY_ROTATION.md](SECURITY_ROTATION.md)
- [MIGRATION_STATIC_TOKENS.md](MIGRATION_STATIC_TOKENS.md)
- [docs/LOCAL_LINKEDIN_E2E_TESTING.md](docs/LOCAL_LINKEDIN_E2E_TESTING.md)
- [docs/COOKIE_REFRESH.md](docs/COOKIE_REFRESH.md)

## Safety Rules
- Never commit `.env`, raw cookies, or tokens.
- Never log `li_at`, `JSESSIONID`, `API_SECRET`, `Authorization`, `x-api-key`, or full private message content.
- Do not bypass LinkedIn checkpoint, captcha, or login protections.
- Respect cooldowns, daily/hourly limits, and one-message E2E rules.
