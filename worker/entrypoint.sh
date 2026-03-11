#!/bin/bash
set -e

# Start virtual display for headed Chrome (LinkedIn detects headless)
Xvfb :99 -screen 0 1366x768x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

export DISPLAY=:99

# Trap signals to clean up Xvfb on container stop
trap "kill $XVFB_PID 2>/dev/null; exit 0" SIGTERM SIGINT

# Wait for Xvfb to be ready
sleep 2

echo "[entrypoint] Xvfb started on :99"
echo "[entrypoint] Starting worker..."

exec node src/index.js
