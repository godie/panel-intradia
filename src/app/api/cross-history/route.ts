import { NextRequest, NextResponse } from "next/server";
import { getCrossHistory, getCrossStats } from "@/lib/cross-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cross-history
 *   ?symbol=BTCUSDT  (optional filter)
 *   ?limit=50        (default 50, max 200)
 *
 * Returns the most recent cross events (EMA55/200, MACD/signal, momentum
 * flips) persisted by /api/analysis. Also includes a `stats` summary
 * with per-symbol counts over the last 7 days.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") ?? "").toUpperCase().trim();
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(200, Math.max(1, Math.floor(limitRaw)))
    : 50;

  try {
    const [events, stats] = await Promise.all([
      getCrossHistory(symbol || undefined, limit),
      getCrossStats(7),
    ]);
    return NextResponse.json(
      { events, stats, count: events.length },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error leyendo historial de cruces";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
