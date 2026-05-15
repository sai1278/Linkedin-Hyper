# 🚀 LinkedIn Hyper-V

> **Self-hosted, multi-account LinkedIn automation dashboard with professional UI**  
> No third-party SaaS • No LinkedIn API • Real browser automation • Full control

<div align="center">

[![Next.js](https://img.shields.io/badge/Next.js-16.1-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue?logo=docker)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## ✨ What's New in This Version

This enhanced version adds a **complete production-grade frontend** with:

### 🔐 **Authentication System**
- **JWT-based login** with secure session management
- Password-protected dashboard access
- Redis-backed token blacklist for instant logout
- Route protection middleware
- Timing-safe password comparison

### 👥 **Account Management GUI**
- **3-step cookie import wizard** with live validation
- Paste JSON or upload `.json` file
- Visual feedback for required cookies (li_at, JSESSIONID)
- Session verification with progress indicator
- Built-in DevTools instructions
- Rate limit monitoring per account
- Account status indicators

### 📊 **Enhanced Dashboard**
- Real-time stats overview
- Messages sent, connections sent, active accounts
- Account status pills with health indicators
- Recent activity feed across all accounts
- Beautiful card-based UI

### 🎨 **Professional UI/UX**
- Dark theme optimized for long sessions
- Framer Motion animations
- Toast notifications
- Loading skeletons (no spinners!)
- Responsive design (mobile-friendly)
- LinkedIn-inspired color scheme

### 🔌 **Real-time Updates**
- WebSocket integration for live notifications
- Auto-reconnect with exponential backoff
- Fallback to polling if WebSocket unavailable
- New message notifications

### 🚀 **Production-Ready Deployment**
- Ubuntu 24.04 LTS automated setup scripts
- Nginx configuration with SSL/TLS
- Let's Encrypt integration
- Health check scripts
- Docker Compose orchestration
- Comprehensive deployment guide

---

## 🎯 Features

### Core Functionality
- ✅ **Unified Inbox** - All messages from every account in one feed
- ✅ **Send Messages** - To existing threads or new conversations
- ✅ **Connection Requests** - With optional personalized notes
- ✅ **Activity Feed** - Track all sent messages and connections
- ✅ **Session Management** - Import LinkedIn cookies via GUI
- ✅ **Rate Limiting** - LinkedIn-safe limits per account (25 messages/day, 15 connections/day)
- ✅ **Multi-Account** - Manage unlimited LinkedIn accounts
- ✅ **Secure** - AES-256-GCM encrypted session storage

### Technical Highlights
| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16, React 19, TypeScript 5, Tailwind CSS v4 |
| **Backend** | Node.js + Express, BullMQ job queue |
| **Automation** | Playwright + Google Chrome (real browser) |
| **Data Store** | Redis (sessions, rate limits, activity logs) |
| **Authentication** | JWT with jose library, Redis blacklist |
| **Deployment** | Docker Compose, Nginx reverse proxy |

---

## 🖼️ Screenshots

### Login Page
Beautiful password-protected entry point with show/hide toggle.

### Dashboard Home
Stats overview showing messages sent, connections, active accounts, and recent activity.

### Account Management
**The crown jewel:** 3-step wizard to import LinkedIn accounts:
1. Enter account ID
2. Import cookies (paste JSON or upload file)
3. Auto-verify session with live progress

### Cookie Import Wizard
- **Live validation** with checkmarks for li_at and JSESSIONID
- **Built-in instructions** with step-by-step DevTools guide
- **File upload support** for `.json` files
- **Visual feedback** for errors and warnings

### Inbox
Unified message inbox with account filtering and real-time updates.

---

## ⚡ Quick Start (5 Minutes)

### Prerequisites
- Docker & Docker Compose
- Ubuntu 24.04 LTS (or similar Linux)
- Domain name (for production HTTPS)

### 1. Automated Server Setup
```bash
git clone https://github.com/your-username/linkedin-hyper-v.git
cd linkedin-hyper-v
bash deployment/ubuntu-setup.sh
```

### 2. Configure Environment
```bash
cp env.example .env

# Generate secrets
echo "DASHBOARD_PASSWORD=$(openssl rand -base64 32)" >> .env
echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env
echo "SESSION_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
echo "API_SECRET=$(openssl rand -hex 24)" >> .env
echo "REDIS_PASSWORD=$(openssl rand -hex 16)" >> .env
echo "ACCOUNT_IDS=alice,bob" >> .env
```

### 3. Setup SSL (Production)
```bash
bash deployment/certbot-setup.sh
# Enter your domain and email when prompted
```

### 4. Deploy
```bash
docker-compose up -d --build
bash deployment/healthcheck.sh
```

### 5. Access Dashboard
Navigate to `https://your-domain.com` and login with `DASHBOARD_PASSWORD`.

### 6. Add LinkedIn Accounts
1. Click **Accounts** in the sidebar
2. Click **Add Account**
3. Enter an account ID (e.g., "alice")
4. Export cookies from your LinkedIn session (see instructions in wizard)
5. Paste or upload the cookie JSON
6. Wait for automatic verification

---

## 📖 Usage Guide

### Adding Your First Account

**Step 1: Export LinkedIn Cookies**
1. Open LinkedIn in your browser and log in
2. Press `F12` to open Developer Tools
3. Go to **Application** → **Cookies** → `https://www.linkedin.com`
4. Use a browser extension like "EditThisCookie" to export as JSON
5. Ensure you have `li_at` and `JSESSIONID` cookies

**Step 2: Import via Dashboard**
1. Navigate to **Accounts** page
2. Click **Add Account**
3. Choose an account ID (e.g., "personal")
4. Paste the exported JSON or upload the file
5. Click **Import & Verify**
6. Wait 10-30 seconds for browser verification
7. Done! Your account is now active

### Sending Messages

**To Existing Conversation:**
1. Go to **Inbox**
2. Select a conversation
3. Type your message
4. Click **Send**

**To New Person:**
1. Click **Compose** button
2. Select account
3. Enter LinkedIn profile URL
4. Type message (max 3000 chars)
5. Click **Send**

### Sending Connection Requests

1. Go to **Connections** page
2. Click **Send Connection Request**
3. Enter profile URL
4. Add optional note (max 300 chars)
5. Click **Send**

---

## 🔧 Configuration

### Environment Variables

```bash
# Dashboard Authentication
DASHBOARD_PASSWORD=        # Dashboard login password
JWT_SECRET=                # JWT signing secret (min 32 chars)
SESSION_MAX_AGE=86400      # Session duration in seconds (24 hours)

# Worker Configuration
SESSION_ENCRYPTION_KEY=    # AES-256-GCM key (64 hex chars)
ACCOUNT_IDS=alice,bob      # Comma-separated account IDs
API_SECRET=                # API secret between frontend and worker
REDIS_PASSWORD=            # Redis authentication

# URLs
API_URL=http://worker:3001              # Internal worker URL
NEXT_PUBLIC_API_URL=http://localhost:3001  # Public worker URL (dev)
NEXT_PUBLIC_WS_URL=wss://your-domain.com/ws  # WebSocket URL (prod)
```

### Rate Limits (LinkedIn-Safe Defaults)
| Action | Daily Limit | Note |
|---|---|---|
| Messages Sent | 25 | Per account |
| Connection Requests | 15 | Per account |
| Profile Views | 60 | Per account |
| Search Queries | 40 | Per account |
| Inbox Reads | 50 | Per account |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Nginx (HTTPS)                      │
│                  Reverse Proxy + SSL                    │
└────────────────────┬────────────────────────────────────┘
                     │
      ┌──────────────┴──────────────┐
      │                             │
┌─────▼─────────┐         ┌────────▼────────┐
│   Next.js     │         │   Worker API    │
│   Frontend    │◄────────┤   (Express)     │
│   Port 3000   │  HTTP   │   Port 3001     │
└───────────────┘         └────────┬────────┘
                                   │
                          ┌────────┴────────┐
                          │                 │
                     ┌────▼─────┐     ┌────▼──────┐
                     │  Redis   │     │ Playwright│
                     │  (Data)  │     │  Browser  │
                     └──────────┘     └───────────┘
```

### Data Flow

1. **User logs in** → JWT token stored in HTTP-only cookie
2. **User adds account** → Cookies encrypted with AES-256-GCM, stored in Redis
3. **User sends message** → Job queued in BullMQ → Worker launches Chrome → Message sent
4. **WebSocket** → Real-time updates pushed to connected clients

---

## 🛡️ Security

### Authentication
- **JWT tokens** with HS256 algorithm
- **Redis blacklist** for instant token revocation on logout
- **Timing-safe** password comparison to prevent timing attacks
- **HTTP-only cookies** to prevent XSS attacks
- **SameSite=Strict** to prevent CSRF

### Session Storage
- **AES-256-GCM encryption** for LinkedIn cookies
- **Redis-only storage** (never touches disk unencrypted)
- **30-day TTL** on all session data
- **Automatic cleanup** of expired sessions

### Network Security
- **HTTPS-only** in production (enforced by Nginx)
- **Strict CSP headers** on all responses
- **Worker API** never exposed publicly (internal Docker network only)
- **Rate limiting** on all LinkedIn actions

### Deployment Security
- **Minimal Docker images** (Alpine Linux)
- **Non-root containers**
- **Resource limits** to prevent OOM
- **Health checks** with automatic restart
- **Firewall rules** (UFW) for SSH, HTTP, HTTPS only

---

## 📊 Monitoring & Maintenance

### Health Checks
```bash
# Automated health check
bash deployment/healthcheck.sh

# Manual checks
docker-compose ps
docker-compose logs -f
curl http://localhost:3001/health
```

### Viewing Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f frontend
docker-compose logs -f worker

# Nginx logs
sudo tail -f /var/log/nginx/linkedin-hyper-v-access.log
```

### Backups
```bash
# Redis data backup
docker exec $(docker-compose ps -q redis) redis-cli -a "$REDIS_PASSWORD" BGSAVE
docker cp $(docker-compose ps -q redis):/data/dump.rdb ./backup-$(date +%Y%m%d).rdb

# Full backup (Redis + .env)
tar -czf linkedin-hyper-v-backup-$(date +%Y%m%d).tar.gz .env dump.rdb
```

### Updates
```bash
git pull origin main
docker-compose down
docker-compose up -d --build
bash deployment/healthcheck.sh
```

---

## 🚨 Troubleshooting

### Common Issues

**"Cannot login" or "Invalid password"**
- Verify `DASHBOARD_PASSWORD` is set in `.env`
- Check `JWT_SECRET` is at least 32 characters
- Ensure Redis is running: `docker-compose ps redis`

**"Session verification failed"**
- Cookies may be expired (re-export from LinkedIn)
- Ensure `SESSION_ENCRYPTION_KEY` is exactly 64 hex characters
- Check worker logs: `docker-compose logs worker`

**"WebSocket not connecting"**
- Verify `NEXT_PUBLIC_WS_URL` uses `wss://` (not `ws://`)
- Check Nginx `/ws` location block configuration
- Verify worker container is reachable

**"Rate limit exceeded"**
- This is intentional to keep you safe from LinkedIn detection
- Limits reset every 24 hours
- Adjust limits in worker code if needed (not recommended)

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## ⚠️ Disclaimer

This tool is for educational and personal use only. Use of automated tools may violate LinkedIn's Terms of Service. Use at your own risk. The authors are not responsible for any account restrictions or bans resulting from the use of this software.

**Be responsible:**
- Respect rate limits
- Don't spam people
- Use for legitimate networking only
- Re-import cookies every 2 weeks (they expire)

---

## 🙏 Acknowledgments

- **Next.js** team for the incredible framework
- **Playwright** team for reliable browser automation
- **Radix UI** for accessible component primitives
- **Tailwind CSS** for utility-first styling
- **Framer Motion** for smooth animations

---

##  Support

- **Issues**: [GitHub Issues](https://github.com/your-username/linkedin-hyper-v/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/linkedin-hyper-v/discussions)
- **Documentation**: [Full Documentation](./DEPLOYMENT.md)

---

<div align="center">

**Built with by developers who value privacy and control**

[ Star this repo](https://github.com/your-username/linkedin-hyper-v) • [🐛 Report Bug](https://github.com/your-username/linkedin-hyper-v/issues) • [💡 Request Feature](https://github.com/your-username/linkedin-hyper-v/issues)

</div>
