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
COPY mini-services/tick-stream/package.json ./mini-services/tick-stream/
COPY mini-services/tick-stream/bun.lock* ./mini-services/tick-stream/

RUN cd mini-services/tick-stream && bun install --frozen-lockfile

COPY mini-services/websocket-security.ts ./mini-services/
COPY mini-services/tick-stream/ ./mini-services/tick-stream/

WORKDIR /app/mini-services/tick-stream

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3005/health || exit 1

CMD ["bun", "index.ts"]
