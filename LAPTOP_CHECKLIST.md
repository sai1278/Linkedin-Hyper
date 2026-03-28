# Laptop Checklist (Before Sir Deploys on DigitalOcean)

## 1) Verify local app once

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-dev.ps1
```

Check:
- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:3001/health`

## 2) Keep secrets local (do NOT share these files)

Do not send/commit:
- `.env.local`
- `.env`
- `cookies-kanchi.json`
- `cookies-sai.json`
- `linkedin-cookies-plain.json`
- `worker/.local-sessions.json`

## 3) Push only code + deployment files

```powershell
git add DEPLOYMENT.md docker-compose.prod.yml deployment/deploy-prod.sh deployment/healthcheck.sh deployment/nginx.conf
git commit -m "Add production deployment flow for DigitalOcean"
git push
```

## 4) Send sir these files/instructions

- `DEPLOYMENT.md`
- `deployment/ubuntu-setup.sh`
- `deployment/certbot-setup.sh`
- `deployment/deploy-prod.sh`
- `deployment/healthcheck.sh`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `env.example`

## 5) Sir runs on DigitalOcean machine

```bash
bash deployment/ubuntu-setup.sh
bash deployment/certbot-setup.sh
bash deployment/deploy-prod.sh
bash deployment/healthcheck.sh
```
