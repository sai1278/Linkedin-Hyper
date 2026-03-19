#!/bin/bash
# Post-deployment health check script for LinkedIn Hyper-V
# Run this script with: bash deployment/healthcheck.sh

set -e

echo "🏥 LinkedIn Hyper-V - Health Check"
echo "==================================="

# Load .env if exists
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

PASSED=0
FAILED=0

# Helper function
check() {
    local name="$1"
    local command="$2"
    
    echo -n "Checking $name... "
    if eval "$command" > /dev/null 2>&1; then
        echo "✅ PASS"
        ((PASSED++))
    else
        echo "❌ FAIL"
        ((FAILED++))
    fi
}

echo ""
echo "🐳 Docker Services"
echo "-------------------"
check "Docker daemon" "docker ps"
check "Docker Compose" "docker-compose ps"
check "Redis container" "docker-compose ps | grep redis | grep -q healthy"
check "Worker container" "docker-compose ps | grep worker | grep -q healthy"
check "Frontend container" "docker-compose ps | grep frontend | grep -q Up"

echo ""
echo "🔌 Service Connectivity"
echo "------------------------"
check "Redis ping" "docker-compose exec -T redis redis-cli -a \"\$REDIS_PASSWORD\" ping | grep -q PONG"
check "Worker API health" "curl -f -s http://localhost:3001/health | grep -q ok"
check "Frontend response" "curl -f -s -o /dev/null http://localhost:3000"

echo ""
echo "🌐 Nginx"
echo "---------"
check "Nginx running" "sudo systemctl is-active nginx"
check "Nginx config valid" "sudo nginx -t"

echo ""
echo "🔒 SSL Certificate"
echo "-------------------"
if [ -d "/etc/letsencrypt/live" ]; then
    CERT_DIR=$(sudo ls /etc/letsencrypt/live | grep -v README | head -1)
    if [ -n "$CERT_DIR" ]; then
        check "SSL certificate exists" "sudo test -f /etc/letsencrypt/live/$CERT_DIR/fullchain.pem"
        check "SSL certificate valid" "sudo openssl x509 -in /etc/letsencrypt/live/$CERT_DIR/fullchain.pem -noout -checkend 2592000"
    fi
else
    echo "⚠️  No SSL certificates found (run certbot-setup.sh)"
fi

echo ""
echo "📊 Summary"
echo "----------"
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo "✅ All checks passed! Your deployment is healthy."
    exit 0
else
    echo ""
    echo "❌ Some checks failed. Please review the output above."
    exit 1
fi
