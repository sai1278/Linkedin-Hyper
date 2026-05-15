ENV_FILE ?= .env

.PHONY: deploy logs logs-worker logs-frontend logs-all health status backup-db backup-redis backup-all rollback

deploy:
	bash deployment/deploy-prod.sh $(ENV_FILE)

logs:
	bash deployment/logs.sh $(ENV_FILE)

logs-worker:
	bash deployment/logs.sh $(ENV_FILE) worker

logs-frontend:
	bash deployment/logs.sh $(ENV_FILE) frontend

logs-all:
	bash deployment/logs.sh $(ENV_FILE)

health:
	bash deployment/healthcheck.sh $(ENV_FILE)

status:
	bash deployment/status.sh $(ENV_FILE)

backup-db:
	bash deployment/backup-postgres.sh $(ENV_FILE)

backup-redis:
	bash deployment/backup-redis.sh $(ENV_FILE)

backup-all:
	bash deployment/backup-all.sh $(ENV_FILE)

rollback:
	@if [ -z "$(REF)" ]; then echo "Usage: make rollback REF=<git-ref> [ENV_FILE=.env]"; exit 1; fi
	bash deployment/rollback.sh "$(REF)" "$(ENV_FILE)"
