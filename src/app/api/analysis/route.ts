import { NextRequest, NextResponse } from "next/server";
import {
  fetchKlines,
  fetchTicker24h,
  BinanceError,
  type Kline,
} from "@/lib/binance";
import {
  calculateEMA,
  findSupportResistance,
  determineCrossState,
} from "@/lib/indicators";
import { buildStructureText } from "@/lib/structure";
import { getCached, setCached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whitelisted symbols — anything else is a 400. */
const ALLOWED_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "XRPUSDT"]);

const CACHE_TTL_MS = 60_000;

/**
 * Analysis payload — matches the contract from the spec exactly, plus a
 * `series` field the frontend needs to draw the sparkline. Every optional
 * numeric field is also mirrored in `no_disponible` so the UI can render
 * "Dato no disponible" instead of a fabricated number.
 */
export type AnalysisResponse = {
  symbol: string;
  spot_price: number | null;
  change_24h_pct: number | null;
  ema55_4h: number | null;
  ema200_4h: number | null;
  cross_state: "ALCISTA" | "BAJISTA" | "COMPRIMIDO" | null;
  resistance: number | null;
  support: number | null;
  structure_text: string;
  no_disponible: {
    spot_price: boolean;
    change_24h_pct: boolean;
    ema55_4h: boolean;
    ema200_4h: boolean;
    cross_state: boolean;
    resistance: boolean;
    support: boolean;
  };
  /** Recent close prices + EMA series for the sparkline (last SPARK_POINTS). */
  series: {
    closes: number[];
    ema55: (number | null)[];
    ema200: (number | null)[];
  };
  updated_at: string;
};

const SPARK_POINTS = 120;

function round(n: number | null, decimals: number): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function decimalsForPrice(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 1) return 2;
  return 4;
}

function buildAnalysis(
  symbol: string,
  klines: Kline[],
  ticker: Awaited<ReturnType<typeof fetchTicker24h>> | null,
): AnalysisResponse {
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);

  // Spot price: prefer ticker.lastPrice, fall back to last close.
  const spotPrice =
    ticker?.lastPrice ?? (closes.length > 0 ? closes[closes.length - 1] : null);
  const change24h = ticker?.priceChangePercent ?? null;

  // EMAs.
  const ema55Res = calculateEMA(closes, 55);
  const ema200Res = calculateEMA(closes, 200);

  // Support / resistance.
  const srRes = findSupportResistance(highs, lows, spotPrice ?? 0);

  // Cross state.
  const crossRes = determineCrossState(ema55Res.last, ema200Res.last);

  // Structure text.
  const structureText = buildStructureText({
    spotPrice,
    ema55: ema55Res.last,
    ema200: ema200Res.last,
    crossState: crossRes.state,
    support: srRes.support,
    resistance: srRes.resistance,
  });

  const dec = spotPrice != null ? decimalsForPrice(spotPrice) : 2;

  const no_disponible = {
    spot_price: spotPrice == null,
    change_24h_pct: change24h == null,
    ema55_4h: !ema55Res.available,
    ema200_4h: !ema200Res.available,
    cross_state: !crossRes.available,
    resistance: srRes.resistance == null,
    support: srRes.support == null,
  };

  // Slice the series for the sparkline (last SPARK_POINTS).
  const startIdx = Math.max(0, closes.length - SPARK_POINTS);
  const seriesCloses = closes.slice(startIdx);
  const seriesEma55 = ema55Res.series.slice(startIdx);
  const seriesEma200 = ema200Res.series.slice(startIdx);

  return {
    symbol,
    spot_price: round(spotPrice, dec),
    change_24h_pct: round(change24h, 2),
    ema55_4h: round(ema55Res.last, dec),
    ema200_4h: round(ema200Res.last, dec),
    cross_state: crossRes.state,
    resistance: round(srRes.resistance, dec),
    support: round(srRes.support, dec),
    structure_text: structureText,
    no_disponible,
    series: {
      closes: seriesCloses,
      ema55: seriesEma55,
      ema200: seriesEma200,
    },
    updated_at: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") ?? "").toUpperCase().trim();

  if (!symbol || !ALLOWED_SYMBOLS.has(symbol)) {
    return NextResponse.json(
      {
        error: `Símbolo inválido. Permitidos: ${[...ALLOWED_SYMBOLS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  // 60s server-side cache.
  const cacheKey = `analysis:${symbol}`;
  const cached = getCached<AnalysisResponse>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "x-cache": "HIT", "cache-control": "no-store" },
    });
  }

  try {
    // Fetch klines + ticker in parallel for speed.
    const [klines, ticker] = await Promise.all([
      fetchKlines(symbol, "4h", 500),
      fetchTicker24h(symbol).catch((e) => {
        // Ticker failure is soft — we can still compute EMAs from klines.
        if (e instanceof BinanceError) return null;
        throw e;
      }),
    ]);

    if (klines.length === 0) {
      throw new BinanceError("Binance devolvió 0 klines");
    }

    const payload = buildAnalysis(symbol, klines, ticker);
    setCached(cacheKey, payload, CACHE_TTL_MS);

    return NextResponse.json(payload, {
      headers: { "x-cache": "MISS", "cache-control": "no-store" },
    });
  } catch (err) {
    const message =
      err instanceof BinanceError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Error desconocido al calcular el análisis";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
