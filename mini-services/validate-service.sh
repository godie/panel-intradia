#!/usr/bin/env bash
#
# Smoke-test a mini-service: boot it the way docker-compose does
# (`bun index.ts` from the service directory), wait for /health, assert the
# payload contract and the socket.io engine path, then shut it down.
#
# Catches what `bun install --frozen-lockfile` cannot: an unresolvable import
# (including the shared ../websocket-security module), a server that never
# binds, a wrong socket.io `path`, a broken /health contract, or an HTTP
# handler that stopped routing.
#
# Usage: validate-service.sh <service-dir> <expected-service> <port>
# Example: validate-service.sh mini-services/order-book order-book 3004

set -euo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
readonly SCRIPT_NAME
readonly READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-30}"
# Engine.IO polling frame that opens a session; the engine path is tested by
# checking this arrives.
readonly HANDSHAKE_PREFIX='0{"sid":'
# One of the defaults the services fall back to when CORS_ORIGINS is unset, so
# the handshake is allowed without the smoke test having to set the env var.
readonly TEST_ORIGIN="${TEST_ORIGIN:-http://localhost:3000}"

# Deliberately global: the EXIT trap outlives main()'s stack frame, so anything
# it reads cannot be a `local` of main.
pid=""
log_file=""

log() { printf '[smoke] %s\n' "$*"; }
fail() {
  printf '[smoke] FAIL: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf 'Usage: %s <service-dir> <expected-service> <port>\n' "$SCRIPT_NAME" >&2
  printf 'Example: %s mini-services/order-book order-book 3004\n' "$SCRIPT_NAME" >&2
}

# Assert the /health contract. Upstream connectivity is deliberately NOT
# asserted: whether Binance/Bybit answer depends on the network, and requiring
# it would make CI flaky. Only the shape and the identity of the service are.
check_health() {
  local health="$1" service="$2" port="$3"
  if ! printf '%s' "$health" | jq -e \
    --arg svc "$service" \
    --argjson port "$port" \
    '(.ok == true)
      and (.service == $svc)
      and (.port == $port)
      and ((.clients | type) == "number")
      and ((.uptime | type) == "number")
      and ((.binanceConnected | type) == "boolean")
      and ((.bybitConnected | type) == "boolean")
      and ((.activeSource == null) or ((.activeSource | type) == "string"))' >/dev/null; then
    fail "/health does not match the contract for $service:$port — got: $health"
  fi
}

# The engine path must be "/socket.io/" (see AGENTS.md). A wrong path still
# binds the port and still answers /health, so this is the cheap way to catch it.
check_socketio_handshake() {
  local base="$1" response
  response="$(curl -fsS --max-time 5 -H "Origin: $TEST_ORIGIN" \
    "$base/socket.io/?EIO=4&transport=polling" 2>/dev/null)" ||
    fail "socket.io handshake failed at $base/socket.io/ (Origin: $TEST_ORIGIN)"
  # case (not [[ == ]]) so the pattern is a glob without tripping SC2053.
  case "$response" in
  "$HANDSHAKE_PREFIX"*) ;;
  *) fail "socket.io handshake returned no session id (wrong path?) — got: ${response:0:120}" ;;
  esac
}

# socket.io's `allowRequest` enforces the Origin whitelist, because CORS headers
# alone do not protect the WebSocket upgrade (cross-site WebSocket hijacking).
# Assert both halves: a missing and a foreign Origin must be refused.
check_origin_enforcement() {
  local base="$1" code
  local url="$base/socket.io/?EIO=4&transport=polling"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url")"
  [[ "$code" == "403" ]] || fail "handshake with no Origin header should be 403, got $code"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'Origin: http://evil.example' "$url")"
  [[ "$code" == "403" ]] || fail "handshake from a foreign Origin should be 403, got $code"
}

check_unknown_path() {
  local base="$1" code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$base/definitely-not-a-route")"
  [[ "$code" == "404" ]] || fail "expected 404 for an unknown path, got $code"
}

main() {
  if (($# != 3)); then
    usage
    exit 2
  fi

  local dir="$1" service="$2" port="$3"

  command -v bun >/dev/null || fail "bun is not on PATH"
  command -v curl >/dev/null || fail "curl is not on PATH"
  command -v jq >/dev/null || fail "jq is not on PATH"
  [[ -d "$dir" ]] || fail "service directory not found: $dir"
  [[ -f "$dir/index.ts" ]] || fail "entry point not found: $dir/index.ts"
  [[ "$port" =~ ^[0-9]+$ ]] || fail "port must be numeric: '$port'"

  cleanup() {
    local code=$?
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      local _
      for _ in 1 2 3 4 5 6; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -9 "$pid" 2>/dev/null || true
    fi
    if [[ -n "${pid:-}" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
    if ((code != 0)); then
      printf '[smoke] --- %s log ---\n' "$service" >&2
      cat "${log_file:-}" >&2 2>/dev/null || true
    fi
    [[ -n "${log_file:-}" ]] && rm -f "$log_file"
    exit "$code"
  }
  trap cleanup EXIT

  log_file="$(mktemp)"
  log "booting $service: bun index.ts (cwd=$dir, port=$port)"

  (cd "$dir" && exec bun index.ts) >"$log_file" 2>&1 &
  pid=$!

  local base="http://127.0.0.1:$port"
  local health="" attempt
  for ((attempt = 1; attempt <= READY_TIMEOUT_SECONDS; attempt++)); do
    if health="$(curl -fsS --max-time 2 "$base/health" 2>/dev/null)" && [[ -n "$health" ]]; then
      log "/health answered after ${attempt}s"
      break
    fi
    health=""
    kill -0 "$pid" 2>/dev/null || fail "$service exited before answering /health"
    sleep 1
  done
  [[ -n "$health" ]] || fail "$service did not answer $base/health within ${READY_TIMEOUT_SECONDS}s"

  check_health "$health" "$service" "$port"
  log "/health contract ok"

  check_socketio_handshake "$base"
  log "socket.io handshake ok (Origin: $TEST_ORIGIN)"

  check_origin_enforcement "$base"
  log "foreign/missing Origin refused with 403"

  check_unknown_path "$base"
  log "unknown path returns 404"

  log "PASS — $service booted and served /health + /socket.io/ on :$port"
}

main "$@"
