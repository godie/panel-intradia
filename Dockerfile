# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Panel Cuantitativo // Intradía — production Dockerfile (multi-stage).
#
# Outputs:
#   - Next.js standalone build (`.next/standalone/`), including the traced
#     node_modules the server actually requires
#   - The mini-services with their own (small) node_modules
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
#   - bash: the entrypoint/all-in-one scripts use `set -u` and `wait -n`
#     (not available in BusyBox sh)
#   - su-exec: ~150 KB replacement for util-linux's `setpriv` used by the
#     entrypoint to drop from root to the `bun` user (it execs, so the app
#     still runs as PID 1 and keeps receiving SIGTERM)
#   - openssl: Prisma engines link against libssl on musl
#   - libstdc++ / libc6-compat: native modules and the Node binary
#   - ca-certificates: HTTPS upstreams. NO wget: BusyBox ships a wget applet
#     that covers the Dockerfile and compose HEALTHCHECKs (`wget -q --spider`
#     is supported) — the GNU binary was ~1 MB for nothing.
#   - NO util-linux: setpriv was its only consumer; replaced by su-exec.
RUN apk add --no-cache \
    bash ca-certificates openssl libstdc++ libc6-compat su-exec \
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
# Stage 2b: prisma-cli — the ONLY node_modules the runner needs besides what
# the standalone bundle already traced.
#
# History: the runner used to copy the whole `node_modules` (1.27 GB with
# devDependencies, 604 MB with `--production`). Next's standalone output is
# already a traced tree (≈150 MB) containing exactly the modules the server
# requires at runtime — copying the full tree on top of it added nothing but
# half a gigabyte of duplicates. The one thing tracing cannot see is the
# Prisma CLI that `docker-entrypoint.sh` runs for `prisma db push`, because it
# is spawned as a subprocess; this stage installs just that package (plus
# @prisma/config + @prisma/engines/…) in an isolated directory.
#
# The version is read from the lockfile-resolved package so the CLI always
# matches the @prisma/client that Next traced into the bundle.
# Must use the same base (musl) as the runtime, so the schema engine matches.
#
# Engine purge: the CLI only runs `prisma db push`, which is served by the
# schema-engine binary alone. The query-engine is dead weight here — at
# runtime the SQLite query engine lives in the *generated client* inside the
# traced standalone node_modules (.prisma/client/libquery_engine-*.so.node),
# never in @prisma/engines. prisma-fmt is only used for `prisma format`.
# Deleting them in this throwaway stage keeps ~40 MB out of the final layer.
# =============================================================================
FROM base AS prisma-cli
WORKDIR /cli

COPY --from=deps /app/node_modules/prisma/package.json /tmp/prisma-package.json

RUN echo '{"name":"prisma-cli","private":true}' > package.json \
 && PRISMA_VERSION="$(bun -e 'console.log(require("/tmp/prisma-package.json").version)')" \
 && echo "[prisma-cli] installing prisma@${PRISMA_VERSION}" \
 && bun add "prisma@${PRISMA_VERSION}" \
 && rm -rf /cli/node_modules/.cache /cli/bun.lock \
 && rm -f /cli/node_modules/@prisma/engines/query-engine-* \
           /cli/node_modules/@prisma/engines/prisma-fmt-*

# Runtime-tree pruning list shared by the CLI-merge and the standalone tree:
# docs, source maps and TypeScript declarations are never read at runtime.
# Test suites inside packages likewise (nobody `require()`s a package's own
# tests). Pruned in throwaway stages so the runner gets one final layer.

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
# Caddy binary for the ALL_IN_ONE variant, copied out of the official image so
# it can proxy without needing a fourth service on the host. Caddy's official
# builds are static (CGO disabled), so the Alpine binary runs on this image.
#
# UPX-compressed in a throwaway stage: UPX decompresses straight into RAM on
# exec, so on-disk ~45 MB → ~15 MB while runtime behaviour stays identical
# (same binary, same flags). `caddy version` also proves the compressed
# binary still runs inside the build.
# =============================================================================
FROM caddy:2-alpine AS caddy-bin

FROM alpine:3.20 AS caddy-upx
RUN apk add --no-cache upx
COPY --from=caddy-bin /usr/bin/caddy /caddy
RUN upx --best --lzma /caddy && /caddy version

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
# Stage 3b: runtime tree — assemble and prune in a throwaway stage.
#
# The tree is exactly what Next traced (`.next/standalone`) plus the Prisma
# CLI and the mini-services. Everything is assembled AND pruned HERE so the
# runner receives one final layer instead of a chain of add-then-delete
# layers (Docker layers are additive: a `rm` in a later stage never shrinks
# the image). /app/db (the volume mount point) is also assembled here.
# =============================================================================
FROM base AS runtime
WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/mini-services ./mini-services
COPY --from=builder /app/prisma ./prisma
# `prisma db push` subprocess (see docker-entrypoint.sh). Merges into the
# standalone `node_modules` without overwriting any traced module.
COPY --from=prisma-cli /cli/node_modules ./node_modules

# Runtime dead weight, all inside the single layer copied into the runner:
#   - glibc native builds of sharp/libvips: this image is Alpine/musl, so the
#     *-linux-arm64/x64 copies (without "musl") can never be loaded (~16 MB)
#   - typescript: a peer dependency that only @prisma/client declares; the
#     build already ran and the standalone server never type-checks (~19 MB)
#   - @prisma/client wasm engines / query compilers for databases this app
#     does not use (SQLite is the only provider in prisma/schema.prisma).
#     Kept: *sqlite*. (~40 MB)
#   - *.md / *.map / *.d.ts / *.tsbuildinfo everywhere in node_modules
#     (ship docs, source maps and type declarations the runtime never reads
#     — ~25–45 MB across the traced tree + the Prisma CLI + socket.io)
#   - package-internal test/ suites and __tests__/ dirs
#   - /app/db mount point pre-created and chowned so the bare image is ready
#     even before the entrypoint re-runs `chown` on a volume
RUN rm -rf \
      node_modules/@img/sharp-linux-* \
      node_modules/@img/sharp-libvips-linux-* \
      node_modules/typescript \
      node_modules/@prisma/client/runtime/query_engine_bg.cockroachdb.* \
      node_modules/@prisma/client/runtime/query_engine_bg.mysql.* \
      node_modules/@prisma/client/runtime/query_engine_bg.postgresql.* \
      node_modules/@prisma/client/runtime/query_engine_bg.sqlserver.* \
      node_modules/@prisma/client/runtime/query_compiler_bg.cockroachdb.* \
      node_modules/@prisma/client/runtime/query_compiler_bg.mysql.* \
      node_modules/@prisma/client/runtime/query_compiler_bg.postgresql.* \
      node_modules/@prisma/client/runtime/query_compiler_bg.sqlserver.* \
      node_modules/.cache \
 && find node_modules mini-services/*/node_modules \
      -type d \( -name test -o -name tests -o -name __tests__ \) \
      -prune -exec rm -rf '{}' + \
 && find node_modules mini-services/*/node_modules \
      -type f \( -name '*.md' -o -name '*.map' -o -name '*.d.ts' \
                 -o -name '*.d.mts' -o -name '*.d.cts' \
                 -o -name '*.tsbuildinfo' \) -delete \
 && mkdir -p /app/db && chown -R bun:bun /app/db

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
# + prisma schema + production-only node_modules + /app/db) as a single layer.
# The --chown replaces the RUN chmod/mkdir dance: the throwaway runtime stage
# already ships the tree final, so no extra layers are created here.
COPY --from=runtime --chown=bun:bun /app ./

# Startup script: initialize the SQLite DB if needed, then exec the
# standalone Next.js server. If a legacy DB already has tables, db push
# is a no-op; if the volume is fresh, it creates the schema.
# --chmod=755 sets the exec bit at copy time (no RUN chmod layer).
COPY --chmod=755 --chown=bun:bun docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Caddy (UPX-compressed) + its config + the all-in-one launcher, for hosts
# that can't run the four compose services (see docker/all-in-one.sh,
# enabled with ALL_IN_ONE=1).
COPY --from=caddy-upx /caddy /usr/local/bin/caddy
COPY --chown=bun:bun Caddyfile /etc/caddy/Caddyfile
COPY --chmod=755 --chown=bun:bun docker/all-in-one.sh /usr/local/bin/all-in-one.sh

# NOTE: deliberately NO `USER bun`. A mounted volume is owned by root, so the
# entrypoint (which starts as root) chowns /app/db and then re-execs itself as
# `bun` via su-exec. Without that, `prisma db push` dies with "unable to open
# database file" because the app user cannot write to the root-owned mount.

EXPOSE 8000 3004 3005

# Note: the `app` service overrides the healthcheck in docker-compose.yml
# (it targets the dashboard root); the mini-services override it too.
# This default just probes the app port so a bare `docker run` is sane.
# BusyBox wget (applet in the Alpine base) supports -q/--spider.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:${PORT:-8000}/ || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# Default command: the Next.js standalone server. docker-compose overrides
# it for the tick-stream / order-book services.
CMD ["bun", "server.js"]
