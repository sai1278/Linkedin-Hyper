# Security Rotation Guide

This guide covers safe rotation of authentication secrets used by the dashboard, proxy, and worker APIs.

## Rotate `API_SECRET`

1. Generate a new random value.
2. Update `API_SECRET` in the production `.env`.
3. Restart the services that read it:
   - `frontend`
   - `worker`
4. Verify:
   - `GET /health`
   - dashboard login
   - account session status
   - account verify
   - manual sync
5. Remove any old copies from shell history, runbooks, or temporary notes.

## Rotate `SERVICE_AUTH_TOKENS`

1. Generate a new raw token value.
2. Hash it with SHA-256 before storing it in `SERVICE_AUTH_TOKENS`.
3. Add metadata for the new token:
   - `id`
   - `role`
   - `expiresAt`
   - `createdAt`
   - `rotatedAt`
   - `audiences`
4. Deploy the updated `.env`.
5. Verify the automation or operator workflow that uses the token.
6. Remove the old token entry after consumers have switched.

## Rotate legacy `PROXY_AUTH_TOKENS` if compatibility mode is still enabled

1. Confirm `ALLOW_STATIC_SERVICE_TOKENS=true` is still intentionally enabled.
2. Replace the old token value in `PROXY_AUTH_TOKENS`.
3. Restart the frontend.
4. Verify proxy-authenticated read and admin-only paths.
5. Remove the old token from any calling systems immediately.

## Rotate legacy `API_ROUTE_AUTH_TOKEN` if compatibility mode is still enabled

1. Confirm `ALLOW_STATIC_SERVICE_TOKENS=true` is still intentionally enabled.
2. Replace `API_ROUTE_AUTH_TOKEN` in `.env`.
3. Restart the frontend.
4. Verify any automation calling the protected Next.js `/api/*` routes.
5. Remove the old token from callers and stored secrets.

## Post-rotation Checklist

1. Update `.env`
2. Restart containers or services
3. Verify `GET /health`
4. Verify dashboard login
5. Verify account session status
6. Verify account `/verify`
7. Verify `/sync/messages`
8. Remove old tokens/secrets from callers and secret stores
9. Document the rotation timestamp and operator

## Safety Notes

- Never commit raw secrets or token values into the repository.
- Never log raw `API_SECRET`, raw service tokens, `li_at`, or `JSESSIONID`.
- Prefer expiring hashed `SERVICE_AUTH_TOKENS` over static compatibility tokens.
