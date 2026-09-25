/**
 * PATCH /api/bot/config — update the bot's symbol/budget/thresholds.
 *
 * `symbol` and `initialCapital` (which also resets `equity`) are rejected
 * while a position is open, so a mid-trade config change can't corrupt the
 * open trade's PnL accounting.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidSymbolFormat } from "@/lib/providers/symbols";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_ID = "default";
const VALID_SIZING = ["full", "fixed_fractional", "half_kelly", "kelly"];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const openTrade = await db.botTrade.findFirst({ where: { status: "OPEN" } });

  const data: Record<string, unknown> = {};

  if (typeof body.symbol === "string") {
    if (openTrade) {
      return NextResponse.json(
        { error: "No se puede cambiar el símbolo con una posición abierta." },
        { status: 400 },
      );
    }
    const symbol = body.symbol.toUpperCase().trim();
    if (!isValidSymbolFormat(symbol)) {
      return NextResponse.json(
        { error: "Símbolo inválido. Debe ser un par USDT válido (ej. BTCUSDT)." },
        { status: 400 },
      );
    }
    data.symbol = symbol;
  }

  if (typeof body.initialCapital === "number") {
    if (openTrade) {
      return NextResponse.json(
        { error: "No se puede cambiar el budget con una posición abierta." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(body.initialCapital) || body.initialCapital <= 0) {
      return NextResponse.json({ error: "initialCapital debe ser un número positivo." }, { status: 400 });
    }
    data.initialCapital = body.initialCapital;
    data.equity = body.initialCapital;
  }

  if (typeof body.minConfidence === "number") data.minConfidence = clamp(body.minConfidence, 0, 100);
  if (typeof body.stopLossPct === "number") data.stopLossPct = clamp(body.stopLossPct, 0.1, 100);
  if (typeof body.takeProfitPct === "number") data.takeProfitPct = clamp(body.takeProfitPct, 0.1, 1000);
  if (typeof body.maxHoldTicks === "number") data.maxHoldTicks = Math.max(1, Math.round(body.maxHoldTicks));
  if (typeof body.fixedFractionalPct === "number") data.fixedFractionalPct = clamp(body.fixedFractionalPct, 1, 100);
  if (typeof body.feeBps === "number") data.feeBps = clamp(body.feeBps, 0, 1000);
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.positionSizing === "string") {
    if (!VALID_SIZING.includes(body.positionSizing)) {
      return NextResponse.json(
        { error: `positionSizing inválido. Usar ${VALID_SIZING.join(", ")}.` },
        { status: 400 },
      );
    }
    data.positionSizing = body.positionSizing;
  }

  const config = await db.botConfig.upsert({
    where: { id: CONFIG_ID },
    update: data,
    create: { id: CONFIG_ID, ...data },
  });

  return NextResponse.json({ config });
}
