# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Panel Cuantitativo // Intradía — production Dockerfile (multi-stage).
#
# Outputs:
#   - Next.js standalone build (`.next/standalone/`)
#   - All node_modules / bun-installed deps for the mini-services
#   - Prisma client + schema
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
# Stage 3: builder — build the Next.js standalone bundle.
# =============================================================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/mini-services/tick-stream/node_modules ./mini-services/tick-stream/node_modules
COPY --from=deps /app/mini-services/order-book/node_modules ./mini-services/order-book/node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# Build Next.js (next.config.ts already has `output: "standalone"`).
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# =============================================================================
# Stage 4: runner — minimal runtime image with everything inside.
# =============================================================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Copy the standalone bundle + static assets + public.
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static
COPY --from=builder --chown=bun:bun /app/public ./public

# Copy mini-services (sources + their node_modules) so they can be run
# from this image by docker-compose.
COPY --from=builder --chown=bun:bun /app/mini-services ./mini-services

# Copy Prisma schema + generated client so `prisma generate` doesn't need
# to run again at startup.
COPY --from=builder --chown=bun:bun /app/prisma ./prisma
COPY --from=deps    --chown=bun:bun /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps    --chown=bun:bun /app/node_modules/@prisma ./node_modules/@prisma

# Persistent SQLite directory — bind-mount a volume here in compose.
RUN mkdir -p /app/db && chown -R bun:bun /app/db

USER bun

EXPOSE 3000 3004 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://localhost:3000/api/cross-history?symbol=BTCUSDT || exit 1

CMD ["echo", "Use docker compose to start the right service (app / tick-stream / order-book)."]
