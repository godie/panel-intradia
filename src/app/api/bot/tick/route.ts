/**
 * POST /api/bot/tick — run one paper-trading tick: evaluate exit conditions
 * for an open position, or ask the decision source for a fresh signal and
 * possibly open one. No real order is ever placed; see src/lib/bot/engine.ts.
 */

import { NextResponse } from "next/server";
import { runBotTick } from "@/lib/bot/engine";
import { UpstreamError } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runBotTick();
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof UpstreamError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Error desconocido al ejecutar el tick del bot.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
