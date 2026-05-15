# Testing

This document describes how to validate Linkedin-Hyper locally and in CI without changing production behavior.

## Test Layers
### Static quality gates
```bash
npm run lint
npx tsc --noEmit --pretty false
npm run build
```

### Unit and integration tests
```bash
npm test
```

### Message-session security tests
```bash
npm run test:security:message-session
```

### OpenAPI validation
```bash
npm run docs:openapi:validate
```

## Local Validation Commands
```bash
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm test
npm run docs:openapi:validate
```

## CI Workflows
Current GitHub Actions workflows:
- `.github/workflows/ci.yml`
- `.github/workflows/frontend-ci.yml`

The CI contract is:
1. `npm ci`
2. `npm run lint`
3. `npx tsc --noEmit --pretty false`
4. `npm run build`
5. `npm test`
6. optional spec validation when included in local release checks

CI must not require:
- real LinkedIn cookies
- real API secrets
- real user passwords
- live send/sync execution against LinkedIn

## Unit / Security Test Areas
Current tests cover:
- auth login validation
- role-based access behavior
- service token validation
- rate-limit logic
- health endpoint behavior
- send-message wrapper/export compatibility
- account ownership and account-access startup validation
- inbox thread state guards
- message-session security rules

## Local E2E Preflight
Use the guarded preflight before any real LinkedIn test.

```bash
npm run test:e2e:preflight
```

Preflight checks:
- frontend reachable
- worker reachable
- DB reachable
- Redis reachable
- account session exists
- required cookies exist
- LinkedIn verify passes
- rate limit allows a safe send
- recipient configuration exists

If preflight fails, stop immediately and do not send a message.

## Real LinkedIn E2E
Real LinkedIn E2E is disabled by default.

Required env examples:
```env
E2E_ENABLE_REAL_LINKEDIN_TESTS=true
E2E_TEST_ACCOUNT_ID=saikanchi130
E2E_TEST_RECIPIENT_NAME=Test Recipient
E2E_TEST_RECIPIENT_PROFILE_URL=https://www.linkedin.com/in/test-recipient
E2E_TEST_USER_EMAIL=admin@example.com
E2E_TEST_USER_PASSWORD=change-me
E2E_TEST_MESSAGE_PREFIX=E2E local test
```

Run:
```bash
npm run test:e2e:linkedin-message
```

Rules:
- send exactly one controlled message per run
- do not use XSS or dangerous payloads in real LinkedIn runs
- do not retry repeatedly if the run fails
- do not bypass checkpoint/captcha
- use only owned or managed test accounts

## PowerShell Equivalents
```powershell
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm test
npm run test:security:message-session
npm run test:e2e:preflight
$env:E2E_ENABLE_REAL_LINKEDIN_TESTS='true'; npm run test:e2e:linkedin-message
```

## Safe Real-Message Test Flow
1. run preflight
2. confirm session/cookies/verify pass
3. run one controlled send through `/api/messages/send-new`
4. verify DB persistence
5. run sync once
6. verify inbox/thread contains the message
7. run sync again
8. confirm no duplicate rows/messages were created

## Common Testing Failures
### `Forbidden: Invalid Origin`
- verify `TRUSTED_ORIGINS`
- verify frontend container env propagation

### `Forbidden: no assigned account access`
- verify `USER_ACCOUNT_ACCESS`
- verify `INITIAL_ADMIN_EMAILS`
- log out and back in so `/api/auth/verify` refreshes the session state

### `COOKIES_MISSING`
- re-capture and re-import cookies
- verify `li_at` and `JSESSIONID` exist locally

### CI failure on account-access config test
- confirm startup-validation check keeps stable fields:
  - `id`
  - `label`
  - `title`
  - count/config booleans

## Related Docs
- [SECURITY.md](SECURITY.md)
- [SWAGGER_API.md](SWAGGER_API.md)
- [docs/LOCAL_LINKEDIN_E2E_TESTING.md](docs/LOCAL_LINKEDIN_E2E_TESTING.md)
