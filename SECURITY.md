# Security

Linkedin-Hyper is designed to keep browser-facing operators, worker automation, and LinkedIn session material separated. This document describes the production security model and the operational rules that go with it.

## Security Model Overview
### Primary controls
- dashboard email/password auth with bcrypt verification
- HTTP-only session cookie for the dashboard
- account-scoped authorization for non-admin users
- same-origin mutation protection for browser writes
- worker API isolation behind the frontend BFF
- Redis-backed rate limiting and cooldowns
- explicit secret rotation procedures

## Authentication Model
### Dashboard auth
- login is handled by `POST /api/auth/login`
- passwords are validated against bcrypt hashes in PostgreSQL
- successful login sets the `app_session` HTTP-only cookie
- logout blacklists the JWT `jti` in Redis
- `GET /api/auth/verify` re-hydrates the session from the DB and current env-based role logic

### Effective role resolution
A user's effective role is resolved from:
1. persisted DB role
2. `INITIAL_ADMIN_EMAILS`

This means an operator can be promoted to admin by configuration without hardcoding a user in source code.

## Account Ownership Model
### Admin users
- can access all accounts
- can operate on all inbox, sync, export, and session routes

### Non-admin users
- can access only assigned accounts
- assignments can come from:
  - persisted DB mapping (`user_account_access`)
  - `USER_ACCOUNT_ACCESS` env configuration
- fail closed if there is no mapping

### Status codes
- `401 Unauthorized`: not authenticated
- `403 Forbidden`: authenticated but not allowed for the requested account or collection
- `400 Bad Request`: missing or invalid `accountId`, `conversationId`, `chatId`, or similar input

## Service Token Model
Preferred operator/service auth uses hashed entries in `SERVICE_AUTH_TOKENS`.

Each entry can include:
- `id`
- `role`
- `tokenHash`
- `expiresAt`
- `createdAt`
- `rotatedAt`
- `audiences`

Supported audiences:
- `proxy`
- `backend-api`

### Compatibility-only legacy paths
These are retained for controlled migrations only:
- `PROXY_AUTH_TOKENS`
- `API_ROUTE_AUTH_TOKEN`
- `ALLOW_STATIC_SERVICE_TOKENS=true`

See [MIGRATION_STATIC_TOKENS.md](MIGRATION_STATIC_TOKENS.md) before using or removing these paths.

## CSRF / Same-Origin Protection
Mutation routes enforce same-origin checks.

Inputs used:
- `Origin`
- `Referer`
- `Sec-Fetch-Site`
- `TRUSTED_ORIGINS`

Blocked cases include:
- invalid or unexpected origin
- invalid referer origin
- cross-site mutation attempts
- missing same-origin proof for mutation routes

This is why misconfigured `TRUSTED_ORIGINS` causes `Forbidden: Invalid Origin`.

## Worker Boundary
The worker should not be publicly trusted as a browser-facing auth surface.

Production pattern:
- frontend handles user auth and ownership checks
- frontend forwards to worker with `X-Api-Key`
- browser should not receive or store the worker secret

## Secret Handling Rules
Never commit or log:
- `.env`
- `API_SECRET`
- `JWT_SECRET`
- `SESSION_ENCRYPTION_KEY`
- `API_ROUTE_AUTH_TOKEN`
- `SERVICE_AUTH_TOKENS` raw values
- `PROXY_AUTH_TOKENS` raw values
- `li_at`
- `JSESSIONID`
- raw `Authorization` headers
- raw `x-api-key` values
- private cookie dumps

Use placeholders only in docs and issues.

## Secret Rotation
If secrets may have been exposed:
1. rotate `.env` values
2. rebuild/restart containers
3. verify health
4. verify login
5. verify sync
6. remove old tokens and stale credentials

Detailed steps live in [SECURITY_ROTATION.md](SECURITY_ROTATION.md).

## Rate Limiting And Abuse Controls
Rate limiting uses Redis-backed counters and cooldowns.

Controls include:
- daily send limits
- hourly send limits
- minimum gap between sends
- burst-window limits
- login brute-force throttling

These controls apply to real LinkedIn sends and should not be bypassed for testing.

## LinkedIn Safety Rules
- Use only owned or managed LinkedIn test accounts.
- Do not spam or bulk test sends.
- Do not bypass checkpoint, captcha, or login protections.
- Real LinkedIn E2E is disabled by default.
- Use one controlled message per real E2E run.

## Logging Rules
Allowed logs:
- request IDs
- route names
- account IDs
- safe error codes
- health summaries
- count-based operational stats

Disallowed logs:
- raw cookies
- raw secrets or tokens
- complete private message content unless explicitly required for local test-only debugging and immediately removed

## Export And Data Privacy
- export routes require authenticated access
- non-admin users are account scoped
- exports should be run only for authorized accounts or conversations
- message data must never be embedded into the public client bundle

## Local E2E Safety
Real LinkedIn tests run only when explicitly enabled:
```env
E2E_ENABLE_REAL_LINKEDIN_TESTS=true
```

Use only test accounts and harmless messages.

## Security Validation Commands
```bash
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm test
npm run test:security:message-session
```

## Related Docs
- [TESTING.md](TESTING.md)
- [SECURITY_ROTATION.md](SECURITY_ROTATION.md)
- [MIGRATION_STATIC_TOKENS.md](MIGRATION_STATIC_TOKENS.md)
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)
