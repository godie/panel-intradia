#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# all-in-one.sh — the whole stack in ONE container.
#
# Runs the Next.js app, both mini-services and Caddy in the same container, the
# same topology as docker-compose but without needing four services on the
# host. Used on hosts that cap the number of services (Railway's free plan
# allows three, and Caddy would be the fourth).
#
# Ports (all local to the container):
#   app          8000  ($PORT, the Dockerfile's default)
#   tick-stream  3005  (hardcoded in the mini-service)
#   order-book   3004  (hardcoded in the mini-service)
#   caddy        $CADDY_PORT (default 8081) — the only one that must be public
#
# The Caddyfile's upstreams already default to localhost:8000/3005/3004, so no
# *_UPSTREAM variables are needed here. `CORS_ORIGINS` still is: the browser's
# Origin is the public domain.
# ----------------------------------------------------------------------------

set -euo pipefail

APP_PORT="${PORT:-8000}"
CADDY_PORT="${CADDY_PORT:-8081}"
export CADDY_PORT

# The entrypoint drops privileges with setpriv, which keeps HOME=/root from the
# root shell — Caddy would then fail to create its config/TLS dirs ("mkdir
# /root/.config: permission denied"). Point it at the bun user's home.
export HOME=/home/bun

log() { printf '[all-in-one] %s\n' "$*"; }

log "starting mini-services (tick-stream :3005, order-book :3004)..."
bun mini-services/tick-stream/index.ts &
TS_PID=$!
bun mini-services/order-book/index.ts &
OB_PID=$!

log "starting the dashboard on :${APP_PORT}..."
PORT="$APP_PORT" bun server.js &
APP_PID=$!

# Caddy is the entrypoint: it listens on the public port and proxies to the
# three processes above. Keep this shell as PID 1 so the trap can forward
# SIGTERM/SIGINT to every child (Railway sends it on redeploy/stop).
cleanup() {
  kill "$APP_PID" "$TS_PID" "$OB_PID" 2>/dev/null || true
}
trap cleanup TERM INT

log "starting caddy on :${CADDY_PORT}..."
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!
trap 'cleanup; kill "$CADDY_PID" 2>/dev/null || true' TERM INT

# Exit as soon as any of the four dies, so the platform can restart us.
wait -n "$CADDY_PID" "$APP_PID" "$TS_PID" "$OB_PID"
log "a process exited — shutting down"
cleanup
kill "$CADDY_PID" 2>/dev/null || true
exit 1
