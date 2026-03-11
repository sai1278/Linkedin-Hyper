# Acumen Blog (Multi-Tenant)

A [Next.js](https://nextjs.org) blog application with a [Strapi CMS](https://strapi.io) backend.

**Supported Tenants:**
- **RegulateThis** - Features Articles and Pillars.
- **Glynac** - Features simpler Blog Posts.

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Docker (recommended for Windows users)

### Running with Docker (Recommended)
1. Start the Strapi backend:
   ```bash
   cd backend
   docker compose up -d
   ```
2. Strapi will be available at [http://localhost:4002/admin](http://localhost:4002/admin).

### Running Natively
1. Start the Strapi backend:
   ```bash
   cd backend
   npm run develop
   ```
2. In a new terminal, start the Next.js frontend:
   ```bash
   npm run dev
   ```

## Setup & Configuration
After starting Strapi for the first time:
1. Create an admin account at `http://localhost:4002/admin`.
2. Configure **Public** role API permissions (Settings → Users & Permissions → Roles → Public):
   - Enable `find` and `findOne` for Article, Author, Pillar, Tag (RegulateThis).
   - Enable `find` and `findOne` for Blog Post (Glynac).
3. The frontend needs `.env.local`:
   ```env
   NEXT_PUBLIC_STRAPI_URL=http://localhost:4002
   ```

## Documentation
- **Backend Guide:** See [backend/README.md](./backend/README.md) for backend-specific details, tenant setup, and content structure.
- **Deployment:** See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions (Render, DigitalOcean, etc.).

## Project Structure
```
├── app/                 # Next.js pages
├── components/          # React components
├── lib/                 # Shared data fetching logic
├── backend/             # Strapi CMS (v5)
└── types/               # TypeScript types
```
