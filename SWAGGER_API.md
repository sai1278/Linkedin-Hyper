# Swagger And OpenAPI

Linkedin-Hyper now documents its browser-facing BFF API with an OpenAPI 3 specification.

## Spec Location
- OpenAPI file: [docs/openapi.yaml](docs/openapi.yaml)

## Why There Is No Runtime Swagger UI Route
A runtime Swagger UI route was intentionally not added in this pass.

Reason:
- the app is already production-safe and this task is documentation-only
- adding a new runtime docs surface would expand the deployed app unnecessarily
- the YAML spec is enough for Swagger UI, Swagger Editor, Redoc, and client generation

This keeps the change low-risk and build-safe.

## How To Open The Spec
### Option 1: Swagger Editor
Open the spec file in your preferred Swagger Editor installation or web-based editor.

### Option 2: Local Swagger UI in Docker
Bash:
```bash
docker run --rm -p 8080:8080 \
  -e SWAGGER_JSON=/spec/openapi.yaml \
  -v "$PWD/docs:/spec" \
  swaggerapi/swagger-ui
```

PowerShell:
```powershell
docker run --rm -p 8080:8080 `
  -e SWAGGER_JSON=/spec/openapi.yaml `
  -v "${PWD}\docs:/spec" `
  swaggerapi/swagger-ui
```

Then open:
- `http://127.0.0.1:8080`

## Security Schemes In The Spec
The spec defines:
- `cookieAuth`
  - dashboard session cookie (`app_session`)
- `apiKeyAuth`
  - `x-api-key` header for controlled worker/admin recovery flows only
- `serviceToken`
  - bearer token compatibility path for operator automation

Use `cookieAuth` for normal dashboard testing.

## Endpoint Groups Documented
- Auth
- Accounts
- Sessions/Cookies
- Messages
- Inbox
- Sync
- Connections
- Stats
- Health
- Export

## Important API Notes
### Same-origin mutation protection
Browser mutation endpoints enforce:
- `Origin`
- `Referer`
- `Sec-Fetch-Site`
- `TRUSTED_ORIGINS`

If you test POST endpoints outside the browser, expect `403 Invalid Origin` unless your request matches the configured trusted origin model or uses the documented operator path.

### Deprecated send endpoint
`POST /api/messages/send` is deprecated and returns `410`.
Use:
- `POST /api/messages/send-new`

### Export endpoints
Export endpoints are implemented as `POST`, not `GET`, because they accept typed filters and return downloadable CSV/JSON payloads.

## Safe Testing Guidance
When using Swagger/OpenAPI tools:
- prefer read-only endpoints first
- do not trigger real LinkedIn send/sync flows accidentally
- use placeholders in auth fields
- use only test accounts and controlled messages when you intentionally call live send endpoints

Recommended safe order:
1. `GET /api/auth/verify`
2. `GET /api/health/startup-validation`
3. `GET /api/inbox/unified`
4. `GET /api/messages/thread`
5. only then test `POST /api/sync/messages` or `POST /api/messages/send-new` in a controlled environment

## Validation
Validate the YAML locally with:
```bash
npm run docs:openapi:validate
```

## Related Docs
- [README.md](README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [TESTING.md](TESTING.md)
