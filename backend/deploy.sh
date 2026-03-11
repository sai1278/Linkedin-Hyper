#!/bin/bash

# =========================================
# Strapi Deployment Script for DigitalOcean
# =========================================

set -e

echo "🚀 Starting Strapi deployment..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo)"
    exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt-get update && apt-get upgrade -y

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "🐳 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl enable docker
    systemctl start docker
fi

# Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null; then
    echo "🐳 Installing Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# Create app directory
APP_DIR="/opt/strapi"
mkdir -p $APP_DIR
cd $APP_DIR

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  Creating .env file with random secrets..."
    cat > .env << EOF
APP_KEYS=$(openssl rand -base64 32),$(openssl rand -base64 32)
API_TOKEN_SALT=$(openssl rand -base64 32)
ADMIN_JWT_SECRET=$(openssl rand -base64 32)
TRANSFER_TOKEN_SALT=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
DATABASE_CLIENT=sqlite
DATABASE_FILENAME=.tmp/data.db
EOF
    echo "✅ .env file created with secure random keys"
fi

# Copy deployment files (user should have these in current directory)
if [ -f "docker-compose.prod.yml" ]; then
    echo "📋 Using existing docker-compose.prod.yml"
else
    echo "❌ docker-compose.prod.yml not found!"
    echo "   Please copy the backend folder to this directory first."
    exit 1
fi

# Build and start
echo "🔨 Building and starting Strapi..."
docker-compose -f docker-compose.prod.yml up -d --build

# Wait for health check
echo "⏳ Waiting for Strapi to start (this may take a few minutes)..."
sleep 30

# Check health
if curl -s http://localhost:4002/_health > /dev/null; then
    echo "✅ Strapi is running!"
    echo ""
    echo "🌐 Access your Strapi admin at: http://$(curl -s ifconfig.me):4002/admin"
else
    echo "⚠️  Strapi may still be starting. Check logs with:"
    echo "   docker-compose -f docker-compose.prod.yml logs -f"
fi

echo ""
echo "📝 Useful commands:"
echo "   View logs:      docker-compose -f docker-compose.prod.yml logs -f"
echo "   Stop Strapi:    docker-compose -f docker-compose.prod.yml down"
echo "   Restart:        docker-compose -f docker-compose.prod.yml restart"
