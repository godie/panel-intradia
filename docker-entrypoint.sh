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
