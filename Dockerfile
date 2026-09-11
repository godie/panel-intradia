# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Panel Cuantitativo // Intradía — production Dockerfile (multi-stage).
#
# Outputs:
#   - Next.js standalone build (`.next/standalone/`)
#   - All node_modules / bun-installed deps for the mini-services
#   - Prisma client + schema + prisma CLI (used at startup to create/push the DB)
#
# Used by `docker-compose.yml` as the base image for the `app`,
# `tick-stream`, and `order-book` services. The `caddy` service uses the
# official `caddy:2-alpine` image and only mounts the Caddyfile.
# ----------------------------------------------------------------------------

ARG BUN_VERSION=1.3.6
ARG NODE_VERSION=20

# =============================================================================
# Stage 1: base — install bun + system deps once.
# =============================================================================
FROM oven/bun:${BUN_VERSION} AS base
WORKDIR /app
# Install minimal tools we need at build time (git for some deps, wget
# for HEALTHCHECKs, ca-certificates for HTTPS upstreams).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget \
 && rm -rf /var/lib/apt/lists/*

# =============================================================================
# Stage 2: deps — install dependencies for the dashboard AND mini-services.
# =============================================================================
FROM base AS deps

# Copy only the lockfiles + package.jsons first so this layer caches well.
COPY package.json bun.lock* ./
COPY mini-services/tick-stream/package.json ./mini-services/tick-stream/
COPY mini-services/order-book/package.json ./mini-services/order-book/
COPY prisma ./prisma
COPY .env* ./

# Install root deps (Next.js, React, Prisma, socket.io-client, …).
RUN bun install --frozen-lockfile

# Install mini-service deps in their own folders so they each get a
# minimal node_modules (socket.io, ws).
RUN cd mini-services/tick-stream && bun install --frozen-lockfile
RUN cd mini-services/order-book  && bun install --frozen-lockfile

# Generate the Prisma client (needs the schema + DATABASE_URL).
RUN bunx prisma generate

# =============================================================================
# Node.js runtime for the Next.js build.
#
# Why: the oven/bun image ships a `node` shim
# (/usr/local/bun-node-fallback-bin/node) that runs `next build` on Bun's
# runtime. There it intermittently dies with SIGILL (exit code 132, "core
# dumped") while tearing down its build workers — see oven-sh/bun#24397,
# #26863 and #39568 (still broken as of 1.3.14). Node is the runtime Next.js
# officially supports, so the builder gets the real thing; it lands in
# /usr/local/bin, which wins the PATH lookup over the fallback-bin shim.
# Used by the builder stage only — the runner still serves the bundle with
# Bun (CMD ["bun", "server.js"]).
# =============================================================================
FROM node:${NODE_VERSION}-bookworm-slim AS node-bin

# =============================================================================
# Stage 3: builder — build the Next.js standalone bundle.
# =============================================================================
FROM base AS builder
WORKDIR /app

COPY --from=node-bin /usr/local/bin/node /usr/local/bin/node
# Verify the shim did not win: `Bun` is only defined inside the Bun runtime.
RUN node -e "if (typeof Bun !== 'undefined') { console.error('FATAL: node resolves to the Bun shim, not Node'); process.exit(1); } console.log('next build will run on Node ' + process.versions.node)"

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/mini-services/tick-stream/node_modules ./mini-services/tick-stream/node_modules
COPY --from=deps /app/mini-services/order-book/node_modules ./mini-services/order-book/node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# Build Next.js (next.config.ts already has `output: "standalone"`).
# HOSTNAME=0.0.0.0 is required: Next standalone defaults to binding
# 0.0.0.0 only in some setups; be explicit so other containers can reach it.
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
RUN bun run build

# =============================================================================
# Stage 4: runner — minimal runtime image with everything inside.
# =============================================================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Next.js standalone server binds to HOSTNAME; default may be localhost.
ENV HOSTNAME=0.0.0.0

# Copy the standalone bundle + static assets + public.
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static
COPY --from=builder --chown=bun:bun /app/public ./public

# Copy mini-services (sources + their node_modules) so they can be run
# from this image by docker-compose.
COPY --from=builder --chown=bun:bun /app/mini-services ./mini-services

# Copy Prisma schema + full node_modules from the deps stage so the app
# (generated client + query engine) and the startup script (prisma CLI via
# `bunx prisma db push`) both work at runtime without re-installing anything.
# Cherry-picking only prisma/@prisma breaks the CLI (transitive deps like
# `effect` would be missing).
COPY --from=builder --chown=bun:bun /app/prisma ./prisma
COPY --from=deps    --chown=bun:bun /app/node_modules ./node_modules

# Startup script: initialize the SQLite DB if needed, then exec the
# standalone Next.js server. If a legacy DB already has tables, db push
# is a no-op; if the volume is fresh, it creates the schema.
COPY --chown=bun:bun docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Persistent SQLite directory — bind-mount a volume here in compose.
RUN mkdir -p /app/db && chown -R bun:bun /app/db

USER bun

EXPOSE 3000 3004 3005

# Note: the `app` service overrides the healthcheck in docker-compose.yml
# (it targets the dashboard root); the mini-services override it too.
# This default just probes the app port so a bare `docker run` is sane.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:${PORT:-3000}/ || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# Default command: the Next.js standalone server. docker-compose overrides
# it for the tick-stream / order-book services.
CMD ["bun", "server.js"]
