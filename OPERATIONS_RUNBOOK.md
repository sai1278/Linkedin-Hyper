# Operations Runbook

## 1. Health Surfaces
1. In-app status page: `/status`
2. Dashboard health panel: `/`
3. Worker health endpoints:
   - `GET /health`
   - `GET /health/summary`
   - `GET /health/startup-validation`

## 2. Preferred Shortcuts
Run these from the project root on the server.

```bash
make deploy
make status
make logs
make logs-worker
make logs-frontend
make backup-db
make backup-redis
make backup-all
make rollback REF=main~1
```

If `make` is not available, use the scripts directly:

```bash
bash deployment/deploy-prod.sh .env
bash deployment/status.sh .env
bash deployment/logs.sh .env worker
bash deployment/backup-all.sh .env
bash deployment/rollback.sh main~1 .env
```

## 3. Deployment
```bash
cd ~/Linkedin-Hyper
make deploy
make status
```

## 4. Log Monitoring
```bash
make logs
make logs-worker
make logs-frontend
```

## 5. Health Checks
Never hardcode the worker API key in commands. Always read it from `.env`.

```bash
KEY="$(grep -E '^API_SECRET=' .env | cut -d= -f2-)"
curl -fsS "http://127.0.0.1:3001/health"
curl -fsS -H "X-Api-Key: $KEY" "http://127.0.0.1:3001/health/summary"
curl -fsS -H "X-Api-Key: $KEY" "http://127.0.0.1:3001/health/startup-validation"
```

## 6. Rollback Procedure
Rollback is git-ref based. It rebuilds `worker` and `frontend` on the chosen known-good ref.

```bash
cd ~/Linkedin-Hyper
make rollback REF=main~1
make status
```

For a tagged release:

```bash
make rollback REF=v1.2.3
```

## 7. Backup Procedure
### Postgres
```bash
make backup-db
```

### Redis
```bash
make backup-redis
```

### Full operational backup
```bash
make backup-all
```

Backups are written into `backups/` with timestamped files.

## 8. Redis Persistence Note
Redis persistence is enabled in Docker Compose already:
1. `/data` is mounted to the `redis_data` volume
2. `--appendonly yes` is enabled
3. `--save 60 1` is enabled

That means queue state and activity logs survive normal container restarts. The backup script is for host-level disaster recovery, not for routine container restarts.

## 9. Postgres Restore Note
The backup output is a gzipped `pg_dump` SQL file. Restore with a fresh or replacement Postgres instance using:

```bash
gunzip -c backups/<timestamp>/postgres-YYYYMMDD-HHMMSS.sql.gz | \
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U linkedinuser -d linkedin_db
```

## 10. Redis Restore Note
Redis backups archive the full `/data` directory. To restore:
1. Stop the stack
2. Replace the Redis volume contents with the archived `/data`
3. Start the stack

Operationally, test restore in a staging environment before relying on it for production recovery.

## 11. Secret Rotation
Use [SECURITY_ROTATION.md](./SECURITY_ROTATION.md) for API secret, service token, and compatibility token rotation procedures.
