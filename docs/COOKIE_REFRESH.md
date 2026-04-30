# Cookie Refresh Runbook

This runbook is for LinkedIn session recovery when a worker account starts failing sync or send because its cookies expired.

Example account used below:

- `saikanchi130`

## When To Use This

Refresh cookies when one or more of these are true:

- `/metrics` shows `sessionExpired.byAccount.saikanchi130 > 0`
- `/metrics` shows `syncFailureTotal > 0` with no matching DB or Redis failures
- `POST /accounts/saikanchi130/verify` returns `SESSION_EXPIRED`, `NO_SESSION`, `LOGIN_NOT_FINISHED`, or `COOKIES_MISSING`
- Inbox sync fails only for one LinkedIn account while `/health` and `/metrics` are otherwise healthy

## Recommended One-Command Flow

If your local machine can reach the worker directly over HTTP, this is now the preferred operator flow:

```powershell
npm run cookies:refresh-direct -- --accountId saikanchi130 --baseUrl http://139.59.98.240:3001 --apiSecret <API_SECRET>
```

What it does:

1. captures cookies locally
2. falls back to interactive login if live-profile capture fails
3. validates the cookie file
4. uploads cookies directly to `/accounts/:accountId/session`
5. verifies the session with `/accounts/:accountId/verify`
6. runs scoped sync with `/sync/messages`

This avoids:

- `scp`
- `ssh`
- manual cookie file upload

Expected log flow:

```text
Capturing cookies...
Uploading cookies...
Verifying session...
Running sync...
SUCCESS
```

## Production-Safe Manual Flow

Use this two-step process:

1. Capture fresh cookies on the local Windows laptop where you can complete LinkedIn login.
2. Import and verify those cookies on the server using the worker's private `API_SECRET`.

This avoids depending on public static bearer tokens in production.

## Local Capture Step (Windows)

Open PowerShell in the repo root:

```powershell
cd "C:\Users\kanchiDhyana sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V"
```

### Preferred: Interactive Capture

Use this when Chrome live-profile capture is blocked or unreliable on Windows.

```powershell
npm run cookies:capture-interactive -- --accountId saikanchi130
```

What this does:

- creates a temporary Chrome profile under:

```text
artifacts\chrome-profiles\saikanchi130\
```

- launches Chrome with that temporary profile
- opens LinkedIn
- waits for you to log in manually
- auto-detects successful login, or lets you press `Enter` in the terminal after login if detection is slow
- writes a plain JSON cookie file to:

```text
artifacts\cookies\saikanchi130\linkedin-cookies-plain.json
```

The command validates that the cookie file:

- exists
- is a JSON array
- contains both `li_at` and `JSESSIONID`

### Existing Live-Profile Capture

If your local Chrome profile is already signed into LinkedIn, you can still try:

```powershell
npm run cookies:capture -- --accountId saikanchi130 --browser chrome --useLiveProfile
```

If this fails with a message like:

```text
Live profile capture failed. Use cookies:capture-interactive instead.
```

switch to `cookies:capture-interactive`.

What live-profile capture does:

- opens a Chrome window using your local LinkedIn browser profile
- waits for a stable authenticated LinkedIn page
- writes a plain JSON cookie file to:

```text
artifacts\cookies\saikanchi130\linkedin-cookies-plain.json
```

If you want a clean temporary browser profile instead of your live one:

```powershell
npm run cookies:capture -- --accountId saikanchi130 --browser chrome
```

## Optional Local Capture + Import In One Step

This is convenient for local/dev or for production only if your deployment explicitly allows static service bearer tokens.

```powershell
npm run cookies:import -- --accountId saikanchi130 --autoCapture --useLiveProfile --baseUrl http://139.59.98.240:3002/api --routeAuthToken <API_ROUTE_AUTH_TOKEN>
```

If production returns:

```text
Static service bearer tokens are disabled in production
```

use the server import flow below instead.

## Copy Cookie File To Server

From the local Windows laptop, copy the captured file to the server.

Example with `scp`:

```powershell
scp .\artifacts\cookies\saikanchi130\linkedin-cookies-plain.json root@139.59.98.240:~/linkedin-cookies-saikanchi130.json
```

Do not paste cookie contents into chat, logs, or shell history.

## Server Import Step

SSH to the server:

```bash
ssh root@139.59.98.240
cd ~/Linkedin-Hyper
API_SECRET_VALUE=$(grep '^API_SECRET=' .env | cut -d= -f2-)
```

Import cookies directly into the worker:

```bash
curl -sS \
  -H "x-api-key: $API_SECRET_VALUE" \
  -H "Content-Type: application/json" \
  -X POST \
  --data-binary @~/linkedin-cookies-saikanchi130.json \
  http://127.0.0.1:3001/accounts/saikanchi130/session | python3 -m json.tool
```

Expected success response:

```json
{
  "success": true,
  "accountId": "saikanchi130",
  "cookieCount": 10,
  "message": "LinkedIn cookies imported successfully for account saikanchi130. Run verify next."
}
```

## Server Verify Step

Verify the imported session:

```bash
curl -sS \
  -H "x-api-key: $API_SECRET_VALUE" \
  -X POST \
  http://127.0.0.1:3001/accounts/saikanchi130/verify | python3 -m json.tool
```

Expected success response:

```json
{
  "ok": true,
  "url": "https://www.linkedin.com/messaging/",
  "via": "feed+messaging",
  "message": "LinkedIn session verification succeeded for account saikanchi130."
}
```

Check persisted session status:

```bash
curl -sS \
  -H "x-api-key: $API_SECRET_VALUE" \
  http://127.0.0.1:3001/accounts/saikanchi130/session/status | python3 -m json.tool
```

Expected result:

- `"exists": true`
- recent `savedAt`

## Sync Test Command

Once verify passes, run a scoped sync:

```bash
curl -sS \
  -H "x-api-key: $API_SECRET_VALUE" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"accountId":"saikanchi130"}' \
  http://127.0.0.1:3001/sync/messages | python3 -m json.tool
```

Healthy result:

- `"success": true`
- `"completed": true`
- `"accountId": "saikanchi130"`

## Local Verify Command

If you want to verify from the local laptop against the public BFF and your deployment allows the route token:

```powershell
npm run cookies:verify -- --accountId saikanchi130 --baseUrl http://139.59.98.240:3002/api --routeAuthToken <API_ROUTE_AUTH_TOKEN>
```

For direct worker verification from the server, prefer the `curl` command above.

## Direct Local HTTP Refresh

If port `3001` is reachable from your laptop, use:

```powershell
cd "C:\Users\kanchiDhyana sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V"
npm run cookies:refresh-direct -- --accountId saikanchi130 --baseUrl http://139.59.98.240:3001 --apiSecret <API_SECRET>
```

What happens:

- the script first tries live-profile capture
- if that fails, it automatically switches to interactive login
- after capture it uploads cookies directly to the worker
- then it verifies the session
- then it runs scoped sync

No `scp` or `ssh` is required for this path.

## How To Confirm The Fix Worked

Confirm all of these:

1. Session verify passes:
   - `ok: true`
2. Session status exists:
   - `exists: true`
3. Sync succeeds:
   - `success: true`
   - `completed: true`
4. `/metrics` stops increasing:
   - `sessionExpired.byAccount.saikanchi130`
   - `syncFailureTotal`
5. Inbox refresh shows the thread again after sync

## Common Errors

### `SESSION_EXPIRED`

Meaning:

- the imported cookies are already expired

Action:

- capture fresh cookies again
- do not reuse an old JSON file from `Downloads` or an earlier day

### `CHECKPOINT_INCOMPLETE`

Meaning:

- LinkedIn challenge, device check, or checkpoint is still active

Action:

- finish the challenge in the browser
- rerun capture

### `LOGIN_NOT_FINISHED`

Meaning:

- the browser reached LinkedIn but not a stable signed-in member page

Action:

- finish login
- wait for LinkedIn feed or messaging to load
- rerun capture

### `COOKIES_MISSING`

Meaning:

- `li_at` and/or `JSESSIONID` were not captured

Action:

- rerun capture from an authenticated LinkedIn page

### `Static service bearer tokens are disabled in production`

Meaning:

- the deployment blocks `API_ROUTE_AUTH_TOKEN` for public BFF operator calls

Action:

- use the production-safe server import flow with `API_SECRET`
- or explicitly enable `ALLOW_STATIC_SERVICE_TOKENS=true` only if your operational policy allows it

## What To Do Next Time LinkedIn Expires Again

Repeat the same sequence:

1. capture locally
2. copy the cookie file to the server
3. import with `API_SECRET`
4. verify
5. run scoped sync

If sync still fails after verify succeeds, check:

- `/metrics` for `sessionExpired.byAccount.saikanchi130`
- worker logs for `verify`, `sync`, or `checkpoint` errors
- whether LinkedIn challenged the account again immediately after login
