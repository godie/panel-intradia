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

export type GatewaySocketTarget = {
  /**
   * Origin to hand to `io()`. Deliberately carries NO path: socket.io-client
   * turns a URL path into the connection's *namespace*, and the mini-services
   * only serve "/".
   */
  url: string;
  /**
   * Engine.IO path INCLUDING the gateway prefix — pass this as `opts.path`.
   * Caddy's `handle_path` strips the prefix, so the mini-service receives the
   * plain `/socket.io/` its engine expects.
   */
  path: string;
};

/**
 * buildGatewaySocketTarget — where to point a Socket.IO client at a
 * mini-service, split into the two halves socket.io-client needs separately.
 *
 * Both halves matter, and swapping them fails in a very non-obvious way:
 *
 *   const t = buildGatewaySocketTarget("3005", window.location);
 *   io(t.url, { path: t.path, transports: ["websocket"] })
 *
 * Putting the prefix in the URL instead — `io("http://host/_tick-stream/socket.io/")`
 * — makes socket.io-client use "/_tick-stream/socket.io" as the namespace and
 * send the engine handshake to the bare origin. Caddy then routes that to the
 * default upstream (the Next app) and the server answers "Invalid namespace".
 * Verified against a real gateway, not just by string comparison.
 */
export function buildGatewaySocketTarget(
  servicePort: string,
  location?: SocketLocation,
): GatewaySocketTarget {
  const prefix = SERVICE_PATHS[servicePort] ?? "";
  const path = `${prefix}/socket.io/`;

  if (!location) {
    // SSR — the client only calls this in the browser. An empty url makes
    // socket.io-client fall back to the page's own location.
    return { url: "", path };
  }

  // Already served by the gateway (or by whatever proxies it) → same origin.
  if (location.port === GATEWAY_PORT) {
    return { url: originOf(location), path };
  }

  // A secure page can't open a plain-HTTP socket; hit the gateway on 443.
  if (location.protocol === "https:") {
    return { url: `https://${location.hostname}`, path };
  }

  // Plain-HTTP page (e.g. the dev server on :3000) → the gateway on :81.
  return {
    url: `${location.protocol}//${location.hostname}:${GATEWAY_PORT}`,
    path,
  };
}

function originOf(location: SocketLocation): string {
  return `${location.protocol}//${location.hostname}${
    location.port ? `:${location.port}` : ""
  }`;
}
