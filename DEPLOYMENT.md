# Deployment Guide

This project is deployed using Docker Compose. The stack consists of:
1. **Next.js Frontend**: The user dashboard.
2. **Worker**: A Node script running Playwright inside a Chrome environment.
3. **Redis**: In-memory store for session metadata, queues, and rate limits.

## Prerequisites
- Docker and Docker Compose installed.
- Valid API keys and environment variables configured.
- Sufficient memory (Playwright requires at least 1-2GB per active session).

## Pre-Launch Checklist
1. Ensure `ACCOUNT_IDS` lists all active LinkedIn accounts comma-separated.
2. Confirm `PROXY_URL` is set if using proxy.
3. Verify that `shm_size` for the worker is set to at least `1gb` to prevent Chrome from crashing.

## Docker Compose Setup

Use the included `docker-compose.yml` file to spin up the architecture.

```bash
docker-compose up -d --build
```

### Environment Variables (.env)
You must create a `.env` file at the root.

```env
API_SECRET=your_secret_here
ACCOUNT_IDS=account1,account2
PROXY_URL=http://user:pass@host:port (optional)
REDIS_URL=redis://redis:6379
```

## Troubleshooting
- If Chrome crashes silently on the worker, ensure `shm_size: 1gb` is actually applied, or run the worker container with `--shm-size=1gb`.
- If Xvfb fails, ensure the worker container is not CPU starved on startup.
