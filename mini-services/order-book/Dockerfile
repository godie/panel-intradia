ARG BUN_VERSION=1.3.6

FROM oven/bun:${BUN_VERSION}
WORKDIR /app

# Install minimal deps (ca-certificates for HTTPS, wget for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget \
 && rm -rf /var/lib/apt/lists/*

# The service imports the shared `../websocket-security` module, so the image
# layout has to mirror the repo (service one level below mini-services/) or the
# import resolves to a path that doesn't exist and the container dies on boot.
# Build context is the repo root.
COPY mini-services/order-book/package.json ./mini-services/order-book/
COPY mini-services/order-book/bun.lock* ./mini-services/order-book/

RUN cd mini-services/order-book && bun install --frozen-lockfile

COPY mini-services/websocket-security.ts ./mini-services/
COPY mini-services/order-book/ ./mini-services/order-book/

WORKDIR /app/mini-services/order-book

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3004/health || exit 1

CMD ["bun", "index.ts"]
