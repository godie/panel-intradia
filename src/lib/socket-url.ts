export type SocketLocation = {
  protocol: string;
  hostname: string;
  port: string;
};

const GATEWAY_PORT = "81";

/**
 * Build the URL used to reach a Socket.IO mini-service through the gateway.
 * HTTPS deployments use the gateway's default secure port instead of an
 * insecure explicit port, avoiding mixed-content WebSocket connections.
 */
export function buildGatewaySocketUrl(
  servicePort: string,
  location?: SocketLocation,
): string {
  const query = `/?XTransformPort=${servicePort}`;
  if (!location) return query;

  if (location.port === GATEWAY_PORT) return query;

  if (location.protocol === "https:") {
    return `https://${location.hostname}${query}`;
  }

  return `${location.protocol}//${location.hostname}:${GATEWAY_PORT}${query}`;
}
