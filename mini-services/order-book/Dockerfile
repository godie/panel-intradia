ARG BUN_VERSION=1.3.6

FROM oven/bun:${BUN_VERSION}
WORKDIR /app

# Install minimal deps (ca-certificates for HTTPS, wget for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget \
 && rm -rf /var/lib/apt/lists/*

# Copy deps + code
COPY mini-services/order-book/package.json ./
COPY mini-services/order-book/bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY mini-services/order-book/ ./

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3004/health || exit 1

CMD ["bun", "index.ts"]
