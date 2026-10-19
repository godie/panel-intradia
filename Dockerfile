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
ARG NODE_VERSION=24

# =============================================================================
# Stage 1: base — install bun + system deps once.
# =============================================================================
FROM oven/bun:${BUN_VERSION}-alpine AS base
WORKDIR /app
# Alpine (musl) keeps the base ~100 MB smaller than the Debian variant.
#   - bash + util-linux: the entrypoint/all-in-one scripts use `set -u`,
#     `wait -n` and `setpriv` (not available in BusyBox sh)
#   - openssl: Prisma engines link against libssl on musl
#   - libstdc++ / libc6-compat: native modules and the Node binary
#   - wget + ca-certificates: HEALTHCHECKs and HTTPS upstreams
RUN apk add --no-cache \
    bash ca-certificates wget openssl libstdc++ libc6-compat util-linux \
 && rm -rf /var/cache/apk/*

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
# Stage 2b: prod-deps — runtime-only dependencies.
#
# The runner used to copy the FULL `node_modules` (devDependencies included:
# eslint, vitest, vite, typescript, SWC, …), which was ~1.27 GB of the image.
# Installing with `--production` and pruning build-only binaries keeps only
# what the standalone server, the mini-services and `prisma db push` need.
# Must use the same base (musl) as the runtime, so native modules match.
# =============================================================================
FROM base AS prod-deps
WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma
COPY .env* ./

RUN bun install --frozen-lockfile --production

# Generate the client for the runtime (Prisma ships the engine here).
RUN bunx prisma generate

# Build-only binaries that never execute at runtime:
#   - @next/swc-* / @swc/core-*: compilers (the bundle is already built)
#   - lightningcss-*: CSS transform for Tailwind at build time
#   - *gnu* variants: this image is Alpine/musl; the glibc copies are dead
#     weight (~150 MB across Next, sharp and libvips).
RUN rm -rf \
      node_modules/@next/swc-* \
      node_modules/@swc/core-* \
      node_modules/lightningcss-* \
      node_modules/@img/sharp-linux-* \
      node_modules/@img/sharp-libvips-linux-* \
      node_modules/.cache

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
# Bun (CMD ["bun", "server.js"]). Must be the Alpine (musl) build so it runs
# on the Alpine base.
# =============================================================================
FROM node:${NODE_VERSION}-alpine AS node-bin

# =============================================================================
# Caddy binary, copied out of the official image so the ALL_IN_ONE variant can
# proxy without needing a fourth service on the host. Caddy's official builds
# are static (CGO disabled), so the Alpine binary runs on this Debian image.
# =============================================================================
FROM caddy:2-alpine AS caddy-bin

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
# Stage 3b: runtime tree — merge standalone + prod deps in a throwaway stage.
#
# Copying `.next/standalone` and then the full `node_modules` directly into
# the runner leaves the production modules duplicated in two layers (Docker
# layers are additive). Merging here means the runner receives ONE layer with
# the union of both trees.
# =============================================================================
FROM base AS runtime
WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/mini-services ./mini-services
COPY --from=builder /app/prisma ./prisma
COPY --from=prod-deps /app/node_modules ./node_modules

# =============================================================================
# Stage 4: runner — minimal runtime image with everything inside.
# =============================================================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8000
# SQLite path for the entrypoint's `prisma db push`. Absolute on purpose: a
# relative `file:` URL resolves against the schema directory (prisma/), not
# /app. Overridable by any deploy-time variable (compose, Railway, …).
ENV DATABASE_URL=file:/app/db/custom.db
# Next.js standalone server binds to HOSTNAME; default may be localhost.
ENV HOSTNAME=0.0.0.0

# Copy the merged runtime tree (standalone + static + public + mini-services
# + prisma schema + production-only node_modules) as a single layer.
COPY --from=runtime --chown=bun:bun /app ./

# Startup script: initialize the SQLite DB if needed, then exec the
# standalone Next.js server. If a legacy DB already has tables, db push
# is a no-op; if the volume is fresh, it creates the schema.
COPY --chown=bun:bun docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Caddy + its config + the all-in-one launcher, for hosts that can't run the
# four compose services (see docker/all-in-one.sh, enabled with ALL_IN_ONE=1).
COPY --from=caddy-bin /usr/bin/caddy /usr/local/bin/caddy
COPY --chown=bun:bun Caddyfile /etc/caddy/Caddyfile
COPY --chown=bun:bun docker/all-in-one.sh /usr/local/bin/all-in-one.sh
RUN chmod +x /usr/local/bin/all-in-one.sh

# Persistent SQLite directory — a Docker/Railway volume mounts here.
RUN mkdir -p /app/db && chown -R bun:bun /app/db

# NOTE: deliberately NO `USER bun`. A mounted volume is owned by root, so the
# entrypoint (which starts as root) chowns /app/db and then re-execs itself as
# `bun`. Without that, `prisma db push` dies with "unable to open database
# file" because the app user cannot write to the root-owned mount.

EXPOSE 8000 3004 3005

# Note: the `app` service overrides the healthcheck in docker-compose.yml
# (it targets the dashboard root); the mini-services override it too.
# This default just probes the app port so a bare `docker run` is sane.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:${PORT:-8000}/ || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# Default command: the Next.js standalone server. docker-compose overrides
# it for the tick-stream / order-book services.
CMD ["bun", "server.js"]
