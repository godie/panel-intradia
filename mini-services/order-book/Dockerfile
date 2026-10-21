# Slim image for the order-book mini-service.
#
# Differences vs the old Debian variant:
#   - oven/bun alpine (musl) base: −~250 MB before installing anything
#   - NO apt-get/wget: BusyBox ships the wget applet the HEALTHCHECK needs
#   - node_modules pruned at install time (*.{md,map,d.ts}, test/, docs/)
#   - USER bun: this service touches no volumes/db, so it can run
#     unprivileged from the start (the main app image can't — its volume
#     needs the entrypoint's chown)
#
# The service imports the shared `../websocket-security` module, so the image
# layout has to mirror the repo (service one level below mini-services/) or the
# import resolves to a path that doesn't exist and the container dies on boot.
# Build context is the repo root.

ARG BUN_VERSION=1.3.6

FROM oven/bun:${BUN_VERSION}-alpine
WORKDIR /app

RUN apk add --no-cache ca-certificates \
 && rm -rf /var/cache/apk/*

COPY mini-services/order-book/package.json ./mini-services/order-book/
COPY mini-services/order-book/bun.lock* ./mini-services/order-book/

# Install + prune in ONE layer so the dead weight never reaches the image.
RUN cd mini-services/order-book \
 && bun install --frozen-lockfile \
 && find node_modules -type f \( -name '*.md' -o -name '*.map' -o -name '*.d.ts' \
      -o -name '*.tsbuildinfo' \) -delete \
 && find node_modules -type d \( -name test -o -name tests -o -name docs \
      -o -name __tests__ \) -prune -exec rm -rf '{}' +

COPY --chown=bun:bun mini-services/websocket-security.ts ./mini-services/
COPY --chown=bun:bun mini-services/order-book/ ./mini-services/order-book/

WORKDIR /app/mini-services/order-book
USER bun

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3004/health || exit 1

CMD ["bun", "index.ts"]
