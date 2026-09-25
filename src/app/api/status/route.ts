import { NextResponse } from "next/server";
import {
  parseHealthPayload,
  resolveServiceTargets,
  type ServiceStatus,
  type ServiceTarget,
  type StatusResponse,
} from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 3000;

/**
 * GET /api/status
 *
 * Server-side probe of each Socket.IO mini-service's `/health`. This answers
 * "can the *server* reach them?" — which is not the same question as "does the
 * browser's socket connect?" (the page shows both; see /status).
 *
 * The probe targets come from the same env vars the Caddy gateway uses, so the
 * result mirrors what the gateway would route to. Nothing here is cached: a
 * status page that shows stale health is worse than no status page.
 */
async function probe(target: ServiceTarget): Promise<ServiceStatus> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(target.healthUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return {
        id: target.id,
        envVar: target.envVar,
        target: target.target,
        reachable: false,
        latencyMs,
        health: null,
        error: `HTTP ${res.status}`,
      };
    }

    const health = parseHealthPayload(await res.json().catch(() => null));
    if (!health) {
      return {
        id: target.id,
        envVar: target.envVar,
        target: target.target,
        reachable: false,
        latencyMs,
        health: null,
        error: "respuesta /health inesperada",
      };
    }

    return {
      id: target.id,
      envVar: target.envVar,
      target: target.target,
      reachable: true,
      latencyMs,
      health,
      error: null,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      id: target.id,
      envVar: target.envVar,
      target: target.target,
      reachable: false,
      latencyMs: null,
      health: null,
      error: aborted
        ? `timeout (${PROBE_TIMEOUT_MS}ms)`
        : err instanceof Error
          ? err.message
          : "error de red",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const services = await Promise.all(resolveServiceTargets().map(probe));
  const payload: StatusResponse = {
    checkedAt: new Date().toISOString(),
    ok: services.every((s) => s.reachable),
    services,
  };
  return NextResponse.json(payload, {
    headers: { "cache-control": "no-store" },
  });
}
