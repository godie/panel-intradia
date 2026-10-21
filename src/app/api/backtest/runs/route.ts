/**
 * /api/backtest/runs — persist a backtest run (POST) and list them (GET).
 * POST validates + serializes (1 MB cap vía backtest-db.ts) y responde con
 * el id creado: aquí el guardado ES el workflow pedido, así que los errores
 * sí se reportan (400/500) — el patrón fire-and-forget de CrossEvent no
 * aplica. El GET devuelve SOLO columnas resumen (sin resultJson).
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  RESULT_JSON_CAP_BYTES,
  truncateResultJson,
  summarizeResult,
} from "@/lib/backtest-db";
import type { BacktestResult } from "@/lib/backtest";
import { isValidSymbolFormat } from "@/lib/providers/symbols";
import { VALID_INTERVALS } from "@/lib/backtest-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUMMARY_SELECT = {
  id: true,
  createdAt: true,
  symbol: true,
  interval: true,
  candles: true,
  strategyId: true,
  strategyName: true,
  isCustom: true,
  totalTrades: true,
  winRatePct: true,
  totalReturnPct: true,
  maxDrawdownPct: true,
  profitFactor: true,
} satisfies Prisma.BacktestRunSelect;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function numOr(cfg: Record<string, unknown>, key: string, def: number): number {
  const v = cfg[key];
  return finite(v) ? v : def;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const cfg =
    body.config != null && typeof body.config === "object" && !Array.isArray(body.config)
      ? (body.config as Record<string, unknown>)
      : null;
  if (!cfg) {
    return NextResponse.json({ error: "Missing config object." }, { status: 400 });
  }

  const symbol = typeof cfg.symbol === "string" ? cfg.symbol.toUpperCase() : "";
  if (!isValidSymbolFormat(symbol)) {
    return NextResponse.json({ error: "Invalid or missing config.symbol." }, { status: 400 });
  }
  const interval = typeof cfg.interval === "string" ? cfg.interval : "";
  if (!VALID_INTERVALS.includes(interval as (typeof VALID_INTERVALS)[number])) {
    return NextResponse.json({ error: `Invalid config.interval: ${interval}` }, { status: 400 });
  }
  const candles =
    finite(cfg.candles) && cfg.candles >= 50 && cfg.candles <= 1000
      ? Math.floor(cfg.candles)
      : 0;
  if (candles === 0) {
    return NextResponse.json(
      { error: "config.candles must be a number in [50, 1000]." },
      { status: 400 },
    );
  }
  const strategyId =
    typeof cfg.strategyId === "string" && cfg.strategyId ? cfg.strategyId : null;
  const strategyName =
    typeof cfg.strategyName === "string" && cfg.strategyName.trim()
      ? cfg.strategyName.trim().slice(0, 120)
      : "";
  if (!strategyName) {
    return NextResponse.json({ error: "config.strategyName is required." }, { status: 400 });
  }
  const isCustom = cfg.isCustom === true;

  const result = body.result;
  if (
    result == null ||
    typeof result !== "object" ||
    !Array.isArray((result as { trades?: unknown }).trades)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid result (BacktestResult shape expected)." },
      { status: 400 },
    );
  }
  const btResult = result as BacktestResult;

  // Config completo (solo tradeLimits flats): white-listed, nunca echo passthrough.
  const configJson = JSON.stringify({
    minConfidence: numOr(cfg, "minConfidence", 60),
    initialCapital: numOr(cfg, "initialCapital", 10_000),
    stopLossPct: numOr(cfg, "stopLossPct", 5),
    takeProfitPct: numOr(cfg, "takeProfitPct", 10),
    maxHoldCandles: numOr(cfg, "maxHoldCandles", 50),
    positionSizing: typeof cfg.positionSizing === "string" ? cfg.positionSizing : "full",
    fixedFractionalPct: numOr(cfg, "fixedFractionalPct", 25),
    feeBps: numOr(cfg, "feeBps", 10),
  });

  const summary = summarizeResult(btResult.stats);
  const t = truncateResultJson(btResult);
  if (Buffer.byteLength(t.json, "utf8") > RESULT_JSON_CAP_BYTES && t.keptTrades === 0) {
    // Cap irreducible incluso con trades=[] (payload degenerado).
    return NextResponse.json(
      { error: `resultJson exceeds the ${RESULT_JSON_CAP_BYTES}-byte cap even after trade truncation.` },
      { status: 400 },
    );
  }

  try {
    const row = await db.backtestRun.create({
      data: {
        symbol,
        interval,
        candles,
        strategyId,
        strategyName,
        isCustom,
        config: configJson,
        totalTrades: summary.totalTrades,
        winRatePct: summary.winRatePct,
        totalReturnPct: summary.totalReturnPct,
        maxDrawdownPct: summary.maxDrawdownPct,
        profitFactor: summary.profitFactor,
        resultJson: t.json,
      },
      select: { id: true },
    });
    return NextResponse.json({ id: row.id, truncated: t.truncated, keptTrades: t.keptTrades });
  } catch (err) {
    console.error("POST /api/backtest/runs failed:", err);
    return NextResponse.json({ error: "Could not persist the run." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
    : 50;
  const symbol = sp.get("symbol")?.toUpperCase() || undefined;
  const strategyId = sp.get("strategyId") || undefined;

  try {
    const runs = await db.backtestRun.findMany({
      where: {
        ...(symbol ? { symbol } : {}),
        ...(strategyId ? { strategyId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: SUMMARY_SELECT,
    });
    return NextResponse.json({ runs });
  } catch (err) {
    console.error("GET /api/backtest/runs failed:", err);
    return NextResponse.json({ error: "Could not list runs." }, { status: 500 });
  }
}
