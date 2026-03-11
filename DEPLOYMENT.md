# Deployment Guide

This document summarizes deployment steps for both the Next.js frontend and Strapi backend.

## Deployment Options

### 1. DigitalOcean App Platform / Nginx Server
For full-stack deployment on an Ubuntu server (e.g., DigitalOcean):
1. **Database:** Set up a PostgreSQL database.
2. **Environment Variables:** Configure the necessary `.env` variables for both frontend and backend.
3. **Backend Service:** Run Strapi via PM2 or Docker (`docker-compose.prod.yml`). Ensure Nginx proxy passes traffic correctly.
4. **Frontend Service:** Build the Next.js app (`npm run build`) and serve using PM2.

### 2. Render.com
Render makes deploying both services straightforward via connecting your GitHub repo.
1. **Database:** Create a managed PostgreSQL database on Render.
2. **Backend (Web Service):**
   - Build Command: `npm run build`
   - Start Command: `npm run start`
   - Set environment variables (e.g., `DATABASE_URL`, `NODE_ENV=production`, `JWT_SECRET`).
3. **Frontend (Static Site or Web Service):**
   - Build Command: `npm run build`
   - Start Command: `npm run start` (if SSR)
   - Ensure `NEXT_PUBLIC_STRAPI_URL` points to the Render backend URL.

## Important Considerations
- **Volumes:** If using local SQLite or local file uploads, be aware that ephemeral services (like basic Render or DO App Platform tiers) will lose data on restart. Always use an external Postgres database and an external file provider (like AWS S3 or Cloudinary) for production environments.
