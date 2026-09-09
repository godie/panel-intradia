export type SocketLocation = {
  protocol: string;
  hostname: string;
  port: string;
};

const GATEWAY_PORT = "81";

// Path prefixes for each mini-service (fixed — not derived from user input).
const SERVICE_PATHS: Record<string, string> = {
  "3005": "/_tick-stream",
  "3004": "/_order-book",
};

/**
 * Build the base URL used to reach a Socket.IO mini-service through the gateway.
 * The returned URL includes the Caddy path prefix so that the socket.io
 * `path: "/socket.io/"` option resolves to `{prefix}/socket.io/`.
 *
 * Routing is path-based (not query-param-based) so a client can never
 * influence which upstream receives its connection.
 *
 * Usage:
 *   io(buildGatewaySocketUrl("3005"), { path: "/socket.io/" }, ...)
 */
export function buildGatewaySocketUrl(
  servicePort: string,
  location?: SocketLocation,
): string {
  const path = SERVICE_PATHS[servicePort] ?? "/";
  const endpoint = `${path}/socket.io/`;

  if (!location) {
    // SSR fallback — relative URL reuses the page origin.
    return endpoint;
  }

  if (location.port === GATEWAY_PORT) {
    return endpoint;
  }

  if (location.protocol === "https:") {
    return `https://${location.hostname}${endpoint}`;
  }

  return `${location.protocol}//${location.hostname}:${GATEWAY_PORT}${endpoint}`;
}
