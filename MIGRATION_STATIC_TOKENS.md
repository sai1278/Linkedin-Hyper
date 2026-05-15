# Static Token Migration Plan

This document describes how to move from compatibility-only static tokens to expiring hashed `SERVICE_AUTH_TOKENS` without breaking current integrations.

## Current Compatibility Behavior

- `SERVICE_AUTH_TOKENS` is the preferred token format.
- `PROXY_AUTH_TOKENS` and `API_ROUTE_AUTH_TOKEN` remain available only for controlled compatibility scenarios.
- `ALLOW_STATIC_SERVICE_TOKENS=true` is required when static compatibility tokens must still be accepted in production.

## Target State

- All machine-to-machine access uses `SERVICE_AUTH_TOKENS`.
- Every service token has:
  - `id`
  - `role`
  - `expiresAt`
  - `createdAt`
  - optional `rotatedAt`
  - `audiences`
- Raw token values are distributed only to callers.
- Only SHA-256 token hashes are stored in configuration.

## Migration Steps

1. Inventory all current callers using:
   - `PROXY_AUTH_TOKENS`
   - `API_ROUTE_AUTH_TOKEN`
2. Create one `SERVICE_AUTH_TOKENS` entry per caller or caller group.
3. Give each new token:
   - a unique `id`
   - the minimum required `role`
   - a realistic `expiresAt`
   - the correct `audiences`
4. Deploy the new `SERVICE_AUTH_TOKENS` alongside the legacy tokens.
5. Update callers to use the new raw token values.
6. Confirm successful calls in logs and health checks.
7. Remove the corresponding legacy token entries.
8. Set `ALLOW_STATIC_SERVICE_TOKENS=false` once all callers are migrated.

## Suggested Deprecation Timeline

1. Week 0: publish `SERVICE_AUTH_TOKENS` and update docs
2. Week 1-2: migrate automation callers
3. Week 3: remove unused `PROXY_AUTH_TOKENS` entries
4. Week 4: remove unused `API_ROUTE_AUTH_TOKEN`
5. Week 4+: disable `ALLOW_STATIC_SERVICE_TOKENS`
6. Later release: remove compatibility code after a quiet period

## Rollback Plan

If a caller fails after cutover:

1. Re-enable `ALLOW_STATIC_SERVICE_TOKENS=true`
2. Restore the minimal required legacy token entry
3. Restart the affected service
4. Confirm the caller works again
5. Resume migration after fixing the caller configuration

## Useful TODO Markers

- TODO(auth-migration): remove legacy static token parsing after all callers are on `SERVICE_AUTH_TOKENS`
- TODO(docs): remove this migration guide after static token compatibility is retired
