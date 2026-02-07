#!/usr/bin/env bash
# Double-click this file to start MoltMarket (backend + dashboard).
# Ctrl-C or close the terminal window to stop.

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $BACKEND_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  wait 2>/dev/null
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "Installing backend dependencies..."
  npm install
fi
if [ ! -d ui/node_modules ]; then
  echo "Installing UI dependencies..."
  npm run ui:install
fi

# Start backend
echo "Starting backend (serve mode on :3000)..."
npm run cli serve --auto-tick &
BACKEND_PID=$!

sleep 2

# Start frontend
echo "Starting frontend (Vite dev on :5173)..."
npm run ui &
FRONTEND_PID=$!

sleep 1
open http://localhost:5173

echo ""
echo "======================================"
echo "  Backend  → http://localhost:3000"
echo "  Dashboard → http://localhost:5173"
echo "======================================"
echo ""
echo "Press Ctrl-C to stop."

wait
