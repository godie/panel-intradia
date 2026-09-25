/**
 * Status — describes how to reach the Socket.IO mini-services and how to read
 * their `/health` payload.
 *
 * The probe targets come from the SAME env vars the Caddy gateway uses
 * (`TICK_STREAM_UPSTREAM` / `ORDER_BOOK_UPSTREAM`), so the status page reflects
 * exactly the upstream the gateway would route to. Unset → the localhost
 * defaults, which is what a bare `bun run dev` needs.
 *
 * Everything here is pure so it can be tested without a network.
 */

export type ServiceId = "tick-stream" | "order-book";

export const SERVICE_IDS: readonly ServiceId[] = ["tick-stream", "order-book"];

/** Env var that overrides the upstream for each service (shared with Caddy). */
export const SERVICE_ENV_VAR: Record<ServiceId, string> = {
  "tick-stream": "TICK_STREAM_UPSTREAM",
  "order-book": "ORDER_BOOK_UPSTREAM",
};

export const DEFAULT_UPSTREAM: Record<ServiceId, string> = {
  "tick-stream": "localhost:3005",
  "order-book": "localhost:3004",
};

export type ServiceTarget = {
  id: ServiceId;
  /** Env var consulted for this target. */
  envVar: string;
  /** Upstream actually probed — "host:port" or a full URL. */
  target: string;
  /** URL the status route fetches. */
  healthUrl: string;
};

/**
 * resolveServiceTargets — the upstream to probe for each mini-service.
 * Blank/whitespace values fall back to the default; trailing slashes are
 * stripped so the appended `/health` never doubles up.
 */
export function resolveServiceTargets(
  env: Record<string, string | undefined> = process.env,
): ServiceTarget[] {
  return SERVICE_IDS.map((id) => {
    const envVar = SERVICE_ENV_VAR[id];
    const configured = env[envVar]?.trim();
    const target = configured
      ? configured.replace(/\/+$/, "")
      : DEFAULT_UPSTREAM[id];
    const healthUrl = /^https?:\/\//i.test(target)
      ? `${target}/health`
      : `http://${target}/health`;
    return { id, envVar, target, healthUrl };
  });
}

/** The mini-service `/health` contract (see each mini-service's index.ts). */
export type MiniServiceHealth = {
  ok: true;
  service: string;
  port: number | null;
  activeSource: string | null;
  binanceConnected: boolean;
  bybitConnected: boolean;
  clients: number;
  uptime: number;
};

/**
 * parseHealthPayload — validates a `/health` response.
 *
 * Only `ok === true` and a string `service` are required; the rest is coerced
 * with safe defaults so a slightly older service doesn't read as unreachable.
 */
export function parseHealthPayload(raw: unknown): MiniServiceHealth | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.ok !== true || typeof r.service !== "string") return null;
  return {
    ok: true,
    service: r.service,
    port: typeof r.port === "number" && Number.isFinite(r.port) ? r.port : null,
    activeSource:
      typeof r.activeSource === "string" ? r.activeSource : null,
    binanceConnected: r.binanceConnected === true,
    bybitConnected: r.bybitConnected === true,
    clients:
      typeof r.clients === "number" && Number.isFinite(r.clients) ? r.clients : 0,
    uptime:
      typeof r.uptime === "number" && Number.isFinite(r.uptime) ? r.uptime : 0,
  };
}

export type ServiceStatus = {
  id: ServiceId;
  /** Env var that controls where this service is expected to be. */
  envVar: string;
  /** Upstream the server tried to reach. */
  target: string;
  reachable: boolean;
  /** Round-trip time, null when the probe never completed. */
  latencyMs: number | null;
  /** The service's own /health payload, when reachable. */
  health: MiniServiceHealth | null;
  /** Why the probe failed, null when reachable. */
  error: string | null;
};

export type StatusResponse = {
  checkedAt: string;
  /** True only when every service answered. */
  ok: boolean;
  services: ServiceStatus[];
};

/**
 * formatUptime — compact human duration: "42s", "1m 30s", "1h 2m", "20d 23h".
 * Returns "—" for non-finite input.
 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) {
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export type Diagnosis =
  /** Server reaches the services AND the browser's sockets are up. */
  | "ok"
  /** Server reaches them, the browser doesn't → gateway / path problem. */
  | "gateway"
  /** The browser connects but the server can't reach them → server-side network. */
  | "server_blind"
  /** Neither side reaches them → not deployed / not running. */
  | "down";

/**
 * diagnose — combines the two independent signals (server-side probe vs the
 * browser's socket connections) into the one conclusion that matters. Keeping
 * them separate is the whole point: "reachable" and "connected" fail for
 * different reasons.
 */
export function diagnose(
  serverReachable: boolean,
  tickConnected: boolean,
  bookConnected: boolean,
): Diagnosis {
  const browserConnected = tickConnected && bookConnected;
  if (serverReachable && browserConnected) return "ok";
  if (serverReachable) return "gateway";
  if (browserConnected) return "server_blind";
  return "down";
}
