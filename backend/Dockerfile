# Strapi Production Dockerfile for Render
FROM node:20-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy ALL source code
COPY . .

# Create data directory
RUN mkdir -p .tmp

# Build Strapi admin panel
RUN npm run build

# Set production environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5603
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Expose port
EXPOSE 5603

# Start Strapi in production mode
CMD ["npm", "run", "start"]
