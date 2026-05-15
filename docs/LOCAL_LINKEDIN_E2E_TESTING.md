# Local LinkedIn Messaging E2E Testing

This runbook adds a safe local-only automation path for LinkedIn message session testing.

## Safety model

- Real LinkedIn tests are **disabled by default**.
- Nothing sends to LinkedIn unless `E2E_ENABLE_REAL_LINKEDIN_TESTS=true`.
- The runner sends **one harmless controlled message per run**.
- The runner stops immediately if preflight checks fail.
- The runner never prints cookie values, API secrets, or service tokens.
- Do not use this against accounts you do not own and manage.
- Do not use this to bypass LinkedIn checkpoint, captcha, or login challenges.

## Files

- `scripts/e2e-preflight.mjs`
- `scripts/e2e-linkedin-message.mjs`
- `tests/message-session.security.test.ts`

## Required local services

Before the real test, make sure these are already running locally:

- frontend at `http://127.0.0.1:3000` or `E2E_FRONTEND_BASE_URL`
- worker at `http://127.0.0.1:3001` or `E2E_WORKER_BASE_URL`
- PostgreSQL reachable through `DATABASE_URL`
- Redis reachable through the worker

If you are using the dedicated local Postgres cluster for E2E, export the same connection string before running preflight:

- `DATABASE_URL=postgresql://linkedinuser:<local-db-password>@127.0.0.1:55432/linkedin_db`
- `POSTGRES_URL` should match `DATABASE_URL`

## Environment variables

### Core

- `E2E_TEST_ACCOUNT_ID=saikanchi130`
- `E2E_TEST_RECIPIENT_NAME=`
- `E2E_TEST_RECIPIENT_PROFILE_URL=`
- `E2E_TEST_MESSAGE_PREFIX="E2E local test"`
- `E2E_ENABLE_REAL_LINKEDIN_TESTS=false`
- `E2E_FRONTEND_BASE_URL=http://127.0.0.1:3000`
- `E2E_WORKER_BASE_URL=http://127.0.0.1:3001`
- `TEST_TIMEOUT_MS=300000`
- `API_SECRET=`
- `DATABASE_URL=`
- `POSTGRES_URL=` (recommended to mirror `DATABASE_URL`)

### App-authenticated send/sync checks

These are required for `test:e2e:linkedin-message` because the real send must go through `/api/messages/send-new`.

- `E2E_TEST_USER_EMAIL=`
- `E2E_TEST_USER_PASSWORD=`

### Optional inbound second-account flow

If these are missing, inbound real-message validation is skipped safely.

- `E2E_INBOUND_SENDER_ACCOUNT_ID=`
- `E2E_INBOUND_RECEIVER_ACCOUNT_ID=`
- `E2E_INBOUND_RECEIVER_PROFILE_URL=`
- `E2E_INBOUND_MESSAGE_PREFIX="E2E inbound local test"`

## What preflight checks

`npm run test:e2e:preflight` verifies:

1. frontend is reachable
2. worker `/health` is healthy
3. DB is reachable
4. Redis is healthy through worker health
5. account session metadata exists
6. required LinkedIn cookies exist locally: `li_at` and `JSESSIONID`
7. worker verify succeeds for the sender account
8. message-send rate limit allows one controlled send
9. recipient config exists
10. generated message prefix is safe/plain-text

If any required check fails, the script exits non-zero and does not send anything.

## Refreshing the local LinkedIn session safely

If worker verify fails because the saved LinkedIn session is stale, refresh cookies before rerunning preflight.

### Safe automated refresh from a managed local Chrome profile

This mode is local-only and never prints cookie values:

```powershell
$env:LI_CAPTURE_COPY_COOKIES = '1'
npm run cookies:capture -- --accountId saikanchi130 --browser chrome --captureProfile "Profile 24"
npm run cookies:import -- --accountId saikanchi130 --cookieFile artifacts\cookies\saikanchi130\linkedin-cookies-plain.json --baseUrl http://127.0.0.1:3001
Remove-Item Env:LI_CAPTURE_COPY_COOKIES
```

Use a different `--captureProfile` only if your managed LinkedIn session lives in another Chrome profile.

If LinkedIn returns a checkpoint or security-verification page during this refresh, stop there and resolve that challenge manually. Do not automate around it.

## Real app -> LinkedIn -> app flow

`npm run test:e2e:linkedin-message` does this only when:

- `E2E_ENABLE_REAL_LINKEDIN_TESTS=true`

Flow:

1. run strict preflight
2. log into the local dashboard via `/api/auth/login`
3. send one unique harmless message through `/api/messages/send-new`
4. poll `/api/messages/thread?refresh=1` to confirm the message is visible in the real LinkedIn thread
5. call `/api/sync/messages`
6. poll `/api/inbox/unified` to confirm the synced message appears in app data
7. query Postgres to confirm the message row exists
8. run sync a second time and confirm the DB row count does not increase
9. if a second managed sender account is configured, send one inbound message to the receiver account and repeat sync + duplicate checks

## Security coverage included

The mocked security suite covers:

- unauthenticated send is blocked
- unauthenticated sync is blocked
- missing `accountId` is blocked
- missing `text` is blocked
- missing `profileUrl` / `chatId` is blocked
- oversized send payload is blocked
- invalid sync `accountId` is rejected at the worker route
- message text renders as escaped text in the inbox thread
- send cooldown rate limiting is enforced

## Commands

### Bash / macOS / Linux

```bash
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm test
npm run test:security:message-session
npm run test:e2e:preflight
E2E_ENABLE_REAL_LINKEDIN_TESTS=true npm run test:e2e:linkedin-message
```

### PowerShell

```powershell
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm test
npm run test:security:message-session
npm run test:e2e:preflight
$env:E2E_ENABLE_REAL_LINKEDIN_TESTS = 'true'
npm run test:e2e:linkedin-message
Remove-Item Env:E2E_ENABLE_REAL_LINKEDIN_TESTS
```

## Interpreting output

Both scripts print JSON summaries.

### Preflight summary

Key fields:

- `frontend`
- `worker`
- `db`
- `redis`
- `session`
- `cookies`
- `verify`
- `rateLimit`
- `recipient`

### Real E2E summary

Key fields:

- `health`
- `session`
- `verify`
- `appToLinkedIn`
- `linkedInToApp`
- `outbound.dbPersisted`
- `outbound.syncVerified`
- `outbound.duplicateCheck`
- `inbound.inboundSenderConfigured`
- `vulnerabilities`

## Expected skips

If you do not configure the second managed sender account, the runner prints:

```text
Inbound real LinkedIn test skipped: second managed test account not configured.
```

That is expected and safe.

## Notes

- The runner intentionally does **not** use deprecated `/api/messages/send`.
- CI should only run the mocked tests. Do not enable real LinkedIn tests in CI.
- If verify fails with login/checkpoint/captcha-related errors, stop and resolve the account session manually. The automation is not designed to bypass those flows.
