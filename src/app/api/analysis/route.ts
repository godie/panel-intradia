import { NextRequest, NextResponse } from "next/server";
import {
  fetchKlines,
  fetchTicker24h,
  BinanceError,
  type Kline,
} from "@/lib/binance";
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  detectMacdCross,
  detectRecentCross,
  findSupportResistance,
  determineCrossState,
} from "@/lib/indicators";
import { buildStructureText } from "@/lib/structure";
import { getCached, setCached } from "@/lib/cache";
import { recordCrossIfNew } from "@/lib/cross-history";
import type { AnalysisResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whitelisted symbols — anything else is a 400. */
const ALLOWED_SYMBOLS = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "XRPUSDT",
  "SOLUSDT",
  "BNBUSDT",
]);

const CACHE_TTL_MS = 60_000;
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

  // RSI(14) on 4h closes.
  const rsiRes = calculateRSI(closes, 14);

  // MACD(12, 26, 9) on 4h closes — Appel defaults.
  const macdRes = calculateMACD(closes, 12, 26, 9);
  // MACD/signal crossover + histogram momentum flip detection.
  const macdCross = macdRes.available
    ? detectMacdCross(macdRes.macdLine, macdRes.signalLine, macdRes.histogram)
    : null;

  // ATR(14) on 4h — volatility measure (Wilder's smoothing).
  const atrRes = calculateATR(highs, lows, closes, 14);

  // Bollinger Bands (20, 2) on 4h — SMA ± 2 stddev.
  const bbRes = calculateBollingerBands(closes, 20, 2);

  // Support / resistance.
  const srRes = findSupportResistance(highs, lows, spotPrice ?? 0);

  // Cross state + recent cross detection.
  const crossRes = determineCrossState(ema55Res.last, ema200Res.last);
  const crossInfo = detectRecentCross(ema55Res.series, ema200Res.series);

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
    cross_info: !ema55Res.available || !ema200Res.available,
    resistance: srRes.resistance == null,
    support: srRes.support == null,
    rsi_14_4h: !rsiRes.available,
    volume_24h_usd: ticker == null,
    high_24h: ticker == null,
    low_24h: ticker == null,
    macd: !macdRes.available,
    macd_cross: !macdRes.available,
    atr_14_4h: !atrRes.available,
    bollinger: !bbRes.available,
  };

  // Slice the series for the sparkline (last SPARK_POINTS).
  const startIdx = Math.max(0, closes.length - SPARK_POINTS);
  const seriesCloses = closes.slice(startIdx);
  const seriesEma55 = ema55Res.series.slice(startIdx);
  const seriesEma200 = ema200Res.series.slice(startIdx);
  const seriesRsi = rsiRes.series.slice(startIdx);
  const seriesMacdHist = macdRes.histogram.slice(startIdx);
  const seriesBbUpper = bbRes.upper.slice(startIdx);
  const seriesBbLower = bbRes.lower.slice(startIdx);

  return {
    symbol,
    spot_price: round(spotPrice, dec),
    change_24h_pct: round(change24h, 2),
    ema55_4h: round(ema55Res.last, dec),
    ema200_4h: round(ema200Res.last, dec),
    cross_state: crossRes.state,
    cross_info: crossInfo,
    resistance: round(srRes.resistance, dec),
    support: round(srRes.support, dec),
    rsi_14_4h: round(rsiRes.last, 2),
    volume_24h_usd: ticker?.quoteVolume ?? null,
    trades_24h: ticker?.trades ?? null,
    high_24h: round(ticker?.highPrice ?? null, dec),
    low_24h: round(ticker?.lowPrice ?? null, dec),
    macd: {
      line: round(macdRes.lastMacd, dec),
      signal: round(macdRes.lastSignal, dec),
      histogram: round(macdRes.lastHistogram, dec),
    },
    macd_cross: macdCross,
    atr_14_4h: round(atrRes.last, dec),
    bollinger: {
      upper: round(bbRes.lastUpper, dec),
      middle: round(bbRes.lastMiddle, dec),
      lower: round(bbRes.lastLower, dec),
      bandwidth: round(bbRes.lastBandwidth, 2),
    },
    structure_text: structureText,
    no_disponible,
    series: {
      closes: seriesCloses,
      ema55: seriesEma55,
      ema200: seriesEma200,
      rsi: seriesRsi,
      macd_histogram: seriesMacdHist,
      bollinger_upper: seriesBbUpper,
      bollinger_lower: seriesBbLower,
    },
    updated_at: new Date().toISOString(),
  };
}

/**
 * persistCrosses — record any fresh EMA/MACD/momentum crosses from the
 * analysis payload to SQLite. Only crosses flagged as `happened` (within the
 * recent threshold) are recorded; dedup by symbol+type+direction within a
 * 6h window for EMA/MACD and 2h for momentum. Non-blocking by design.
 */
async function persistCrosses(payload: AnalysisResponse): Promise<void> {
  const price = payload.spot_price ?? 0;
  const tasks: Promise<void>[] = [];

  // EMA55/200 cross.
  if (payload.cross_info?.happened === true && payload.cross_info.direction) {
    tasks.push(
      recordCrossIfNew({
        symbol: payload.symbol,
        type: "ema",
        direction: payload.cross_info.direction,
        price,
        candlesAgo: payload.cross_info.candles_since_cross ?? 0,
      }),
    );
  }

  // MACD/signal cross.
  if (payload.macd_cross?.happened === true && payload.macd_cross.direction) {
    tasks.push(
      recordCrossIfNew({
        symbol: payload.symbol,
        type: "macd",
        direction: payload.macd_cross.direction,
        price,
        candlesAgo: payload.macd_cross.candles_since_cross ?? 0,
      }),
    );
  }

  // MACD histogram momentum flip.
  if (
    payload.macd_cross?.momentum_flip === true &&
    payload.macd_cross.momentum_flip_direction
  ) {
    tasks.push(
      recordCrossIfNew({
        symbol: payload.symbol,
        type: "momentum",
        direction: payload.macd_cross.momentum_flip_direction,
        price,
        candlesAgo: payload.macd_cross.candles_since_flip ?? 0,
      }),
    );
  }

  if (tasks.length > 0) await Promise.all(tasks);
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

    // Persist any fresh crosses to SQLite (fire-and-forget, non-blocking).
    // Dedup is handled inside recordCrossIfNew — only NEW crosses are stored.
    persistCrosses(payload).catch((e) => {
      console.error("[analysis] persist crosses error:", e);
    });

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
