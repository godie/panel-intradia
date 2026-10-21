/**
 * /api/backtest/runs/[id] — full payload of one persisted run (GET) and
 * delete (DELETE). GET parses resultJson defensively (parseStoredResult):
 * payload corrupto → 500 con la razón, JAMÁS datos fabricados.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseStoredResult } from "@/lib/backtest-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const row = await db.backtestRun.findUnique({
      where: { id },
      select: {
        id: true,
        createdAt: true,
        symbol: true,
        interval: true,
        candles: true,
        strategyId: true,
        strategyName: true,
        isCustom: true,
        config: true,
        totalTrades: true,
        winRatePct: true,
        totalReturnPct: true,
        maxDrawdownPct: true,
        profitFactor: true,
        resultJson: true,
      },
    });
    if (!row) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    const parsed = parseStoredResult(row.resultJson);
    if (!parsed.ok) {
      // Corrupción de BD (defensa del spec: nunca datos fabricados).
      return NextResponse.json({ error: parsed.reason }, { status: 500 });
    }
    return NextResponse.json({
      run: row,
      result: parsed.result,
      truncation: parsed.truncatedMeta,
    });
  } catch (err) {
    console.error("GET /api/backtest/runs/[id] failed:", err);
    return NextResponse.json({ error: "Could not load the run." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const deleted = await db.backtestRun.deleteMany({ where: { id } });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    return NextResponse.json({ removed: true });
  } catch (err) {
    console.error("DELETE /api/backtest/runs/[id] failed:", err);
    return NextResponse.json({ error: "Could not delete the run." }, { status: 500 });
  }
}
