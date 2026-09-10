#!/bin/bash
# Starts the dev server + mini-services in the background, fully detached.
# Used to keep services running across shell sessions.
# Run from anywhere — paths are resolved relative to this script.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN_BIN="$(command -v bun || echo /usr/local/bin/bun)"

# Kill any existing instances
pkill -9 -f "next dev" 2>/dev/null
pkill -9 -f "mini-services/tick-stream" 2>/dev/null
pkill -9 -f "mini-services/order-book" 2>/dev/null
sleep 1

# Start Next.js dev server (port 3000)
(
  cd "$ROOT"
  setsid nohup "$BUN_BIN" run dev > dev.log 2>&1 < /dev/null &
) &

# Start mini-services
for svc in tick-stream order-book; do
  (
    cd "$ROOT/mini-services/$svc"
    setsid nohup "$BUN_BIN" run dev > /tmp/$svc.log 2>&1 < /dev/null &
  ) &
done

echo "Started dev server (3000), tick-stream (3005), order-book (3004)"
sleep 8

# Verify
for p in 3000 3004 3005; do
  echo -n "Port $p: "
  curl -s --max-time 3 http://localhost:$p/health 2>/dev/null | head -c 80 || echo "(no health endpoint)"
  echo ""
done
