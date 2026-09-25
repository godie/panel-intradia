# Caddy gateway image.
#
# docker-compose bind-mounts the Caddyfile at runtime, which Railway can't do
# (it builds from the repo and has no way to mount a single file). Baking it in
# keeps one Caddyfile as the single source of truth for both.
#
# Build context MUST be the repo root, e.g.:
#   docker build -f caddy/Dockerfile -t panel-caddy .
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
