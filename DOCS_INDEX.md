# Documentation Index

Central navigation page for Linkedin-Hyper engineering documentation.

Use this document as the starting point for onboarding, production operations, troubleshooting, release readiness, and API review.

## Recommended Reading Order
1. [README.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\README.md)
2. [ARCHITECTURE.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\ARCHITECTURE.md)
3. [DEPLOYMENT.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\DEPLOYMENT.md)
4. [OPERATIONS_RUNBOOK.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\OPERATIONS_RUNBOOK.md)
5. [SECURITY.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SECURITY.md)
6. [TESTING.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\TESTING.md)
7. [SWAGGER_API.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SWAGGER_API.md)

## Quick Links
- Project overview: [README.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\README.md)
- System design: [ARCHITECTURE.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\ARCHITECTURE.md)
- Production deploy guide: [DEPLOYMENT.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\DEPLOYMENT.md)
- Operations and incident handling: [OPERATIONS_RUNBOOK.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\OPERATIONS_RUNBOOK.md)
- Security model: [SECURITY.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SECURITY.md)
- Test strategy: [TESTING.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\TESTING.md)
- API docs and Swagger usage: [SWAGGER_API.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SWAGGER_API.md)
- OpenAPI spec: [docs/openapi.yaml](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\docs\openapi.yaml)

## Documentation Categories

### Overview
- [README.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\README.md)
  - Product summary
  - Quick start
  - Core commands
  - Project structure

### Architecture
- [ARCHITECTURE.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\ARCHITECTURE.md)
  - Frontend, BFF, worker, Redis, and PostgreSQL design
  - LinkedIn session flow
  - Sync and send flows
  - Auth and account access model
  - Mermaid diagrams

### Deployment
- [DEPLOYMENT.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\DEPLOYMENT.md)
  - Production server deployment
  - Docker Compose commands
  - Health checks
  - Rollback guidance
- [env.example](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\env.example)
  - Placeholder environment variable reference

### Operations
- [OPERATIONS_RUNBOOK.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\OPERATIONS_RUNBOOK.md)
  - Daily operator procedures
  - Logs, health, verify, sync, export
  - Common recovery steps
- [docs/COOKIE_REFRESH.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\docs\COOKIE_REFRESH.md)
  - Cookie capture/import/refresh procedures

### Security
- [SECURITY.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SECURITY.md)
  - Auth model
  - Ownership model
  - CSRF/same-origin protection
  - Service token model
  - Logging restrictions
- [SECURITY_ROTATION.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SECURITY_ROTATION.md)
  - Secret rotation steps
- [MIGRATION_STATIC_TOKENS.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\MIGRATION_STATIC_TOKENS.md)
  - Legacy token migration and deprecation path

### Testing And Quality
- [TESTING.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\TESTING.md)
  - Lint, typecheck, build, unit, security, and E2E testing
- [docs/LOCAL_LINKEDIN_E2E_TESTING.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\docs\LOCAL_LINKEDIN_E2E_TESTING.md)
  - Controlled local LinkedIn E2E test procedure

### API And Swagger
- [SWAGGER_API.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SWAGGER_API.md)
  - Swagger/OpenAPI usage guidance
  - Auth scheme usage
  - Safe API testing notes
- [docs/openapi.yaml](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\docs\openapi.yaml)
  - OpenAPI 3 specification

### Troubleshooting
- [DEPLOYMENT.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\DEPLOYMENT.md)
  - Deployment-time failures
  - Health/runtime checks
- [OPERATIONS_RUNBOOK.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\OPERATIONS_RUNBOOK.md)
  - Session, sync, and runtime recovery
- [TESTING.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\TESTING.md)
  - CI and validation failures
- [SECURITY.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SECURITY.md)
  - Auth, origin, and ownership troubleshooting context

## Task-Oriented Navigation

### I want to understand the system
- Start with [README.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\README.md)
- Then read [ARCHITECTURE.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\ARCHITECTURE.md)

### I want to deploy or rebuild production
- Read [DEPLOYMENT.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\DEPLOYMENT.md)
- Cross-check [OPERATIONS_RUNBOOK.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\OPERATIONS_RUNBOOK.md)

### I need to verify auth, ownership, or security behavior
- Read [SECURITY.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SECURITY.md)
- Then inspect [SECURITY_ROTATION.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SECURITY_ROTATION.md) and [MIGRATION_STATIC_TOKENS.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\MIGRATION_STATIC_TOKENS.md) if relevant

### I need to test the system
- Read [TESTING.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\TESTING.md)
- Use [docs/LOCAL_LINKEDIN_E2E_TESTING.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\docs\LOCAL_LINKEDIN_E2E_TESTING.md) for controlled real-account validation

### I need API documentation for review or integration
- Read [SWAGGER_API.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SWAGGER_API.md)
- Open [docs/openapi.yaml](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\docs\openapi.yaml)

### I need to troubleshoot a live issue
- Start with [OPERATIONS_RUNBOOK.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\OPERATIONS_RUNBOOK.md)
- Then use [DEPLOYMENT.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\DEPLOYMENT.md), [SECURITY.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SECURITY.md), and [TESTING.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\TESTING.md) depending on the failure area

## Maintenance Notes
- Keep this index updated when new canonical docs are added or renamed.
- Prefer linking to canonical docs first, then legacy/reference docs second.
- Use placeholders only when documenting env vars, tokens, cookies, or secrets.

## Canonical Documentation Set
- [README.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\README.md)
- [ARCHITECTURE.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\ARCHITECTURE.md)
- [DEPLOYMENT.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\DEPLOYMENT.md)
- [OPERATIONS_RUNBOOK.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\OPERATIONS_RUNBOOK.md)
- [SECURITY.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SECURITY.md)
- [TESTING.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\TESTING.md)
- [SWAGGER_API.md](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\SWAGGER_API.md)
- [docs/openapi.yaml](C:\Users\kanchiDhyana%20sai\OneDrive\Desktop\linkedin\Linkedin-Hyper-V\docs\openapi.yaml)
