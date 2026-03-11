# Next.js Frontend Dockerfile for Render
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application (will use placeholders for env vars)
# The actual values come from runtime environment variables
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Expose port
EXPOSE 3000

# Start Next.js standalone server
# Environment variables NEXT_PUBLIC_STRAPI_URL and NEXT_PUBLIC_STRAPI_API_TOKEN
# will be picked up from Render's environment variables at runtime
CMD ["node", "server.js"]
