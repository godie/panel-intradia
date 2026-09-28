#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# docker-entrypoint.sh — Panel Cuantitativo // Intradía
#
# Runs as the ENTRYPOINT for every service container. For the `app` service
# it initializes the SQLite database (fresh volumes have no schema) and then
# execs the container command. For the mini-services, DB init is skipped
# (they don't touch the database).
# ----------------------------------------------------------------------------

set -euo pipefail

# A mounted volume (Docker named volume, Railway volume) is owned by root,
# while the app must not run as root. So: prepare the mount, then re-exec this
# same script as `bun` — the DB init below AND the container command then run
# unprivileged. Without this, `prisma db push` fails with "unable to open
# database file: /app/db/custom.db" on every host that mounts a volume there.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/db
  chown -R bun:bun /app/db 2>/dev/null || true
  # `setpriv` (not `runuser`, which forks) so the app stays PID 1 and keeps
  # receiving SIGTERM from the orchestrator.
  exec setpriv --reuid="$(id -u bun)" --regid="$(id -g bun)" --init-groups \
    "$0" "$@"
fi

# Skip DB init for services that don't use the database (mini-services),
# for placeholder commands, and for explicit opt-out via SKIP_DB_INIT=1.
if [ "${SKIP_DB_INIT:-0}" != "0" ] || [ "${1:-}" = "echo" ]; then
  SKIP_DB_INIT=1
fi

if [ "${SKIP_DB_INIT:-0}" = "0" ]; then
  echo "[entrypoint] Ensuring SQLite schema exists (prisma db push)..."
  # `bunx prisma` resolves the locally installed CLI (node_modules/prisma,
  # copied in the runner stage) without network access. --accept-data-loss
  # only matters if an old volume has a divergent schema; on a fresh volume
  # this simply creates the tables.
  bunx prisma db push --accept-data-loss --skip-generate
  echo "[entrypoint] DB ready."
fi

# Replace shell with the container command (PID 1 signal handling).
exec "$@"
