/**
 * Tests for collectCrossCandidates — the pure extraction of "fresh" crosses
 * from an analysis payload (restores the write path that died in PR #4).
 * See docs/superpowers/plans/2026-10-21-cross-history-persistence-restore.md
 */

import { describe, it, expect } from "vitest";
import { collectCrossCandidates } from "./cross-history";
import type { AnalysisResponse } from "./types";

// `Record<string, unknown>` a propósito: el payload en runtime trae top-level
// nulls (p.ej. stoch_cross: null) que su tipo structural no permite, y los
// tests de nulos necesitan inyectarlos.
function basePayload(overrides: Record<string, unknown> = {}): AnalysisResponse {
  return {
    symbol: "BTCUSDT",
    timeframe: "4h",
    spot_price: 80468.63,
    change_24h_pct: 2.3,
    ema55: 82453.99,
    ema200: 81958.3,
    cross_state: "ALCISTA",
    cross_info: { happened: true, candles_since_cross: 2, direction: "bullish", window: 10 },
    resistance: null,
    support: null,
    rsi_14: 55,
    volume_24h_usd: null,
    trades_24h: null,
    high_24h: null,
    low_24h: null,
    macd: { line: 1, signal: 0.5, histogram: 0.5 },
    macd_cross: {
      happened: true,
      candles_since_cross: 1,
      direction: "bullish",
      momentum_flip: true,
      momentum_flip_direction: "bearish",
      candles_since_flip: 3,
      window: 6,
    },
    atr_14: 100,
    bollinger: { upper: 2, middle: 1, lower: 0, bandwidth: 3.5 },
    bollinger_squeeze: { is_squeezed: false, threshold_pct: 3, bandwidth: 3.5 },
    squeeze_breakout: { happened: false, direction: null, candles_since_breakout: null, bandwidth_before: null, bandwidth_after: null },
    stop_loss_suggestion: null,
    fibonacci: null,
    vwap_20: null,
    stochastic: { k: 50, d: 48 },
    stoch_cross: { happened: true, candles_since_cross: 4, direction: "bullish", k_at_cross: 30 },
    ichimoku: {
      tenkan: 1, kijun: 1, senkou_a: 1, senkou_b: 1, chikou: 1,
      cloud_color: "bullish", price_vs_cloud: "above",
    },
    structure_text: "",
    source: "binance",
    no_disponible: {} as AnalysisResponse["no_disponible"],
    ...overrides,
  } as unknown as AnalysisResponse;
}

describe("collectCrossCandidates", () => {
  it("ema fresh → 1 candidato 'ema' bullish", () => {
    const p = basePayload({ macd_cross: null, stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null } });
    const out = collectCrossCandidates(p);
    expect(out).toEqual([
      { symbol: "BTCUSDT", type: "ema", direction: "bullish", price: 80468.63, candlesAgo: 2 },
    ]);
  });

  it("macd cross + momentum flip → 2 candidatos distintos", () => {
    const p = basePayload({
      cross_info: { happened: false, candles_since_cross: null, direction: null, window: 10 },
      stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null },
    });
    const out = collectCrossCandidates(p);
    expect(out.map((c) => c.type).sort()).toEqual(["macd", "momentum"]);
  });

  it("squeeze_breakout happened → candidato con la direction del breakout", () => {
    const p = basePayload({
      cross_info: { happened: false, candles_since_cross: null, direction: null, window: 10 },
      macd_cross: null,
      stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null },
      squeeze_breakout: { happened: true, direction: "bearish", candles_since_breakout: 2, bandwidth_before: 2.8, bandwidth_after: 4.1 },
    });
    const out = collectCrossCandidates(p);
    expect(out).toEqual([
      { symbol: "BTCUSDT", type: "squeeze_breakout", direction: "bearish", price: 80468.63, candlesAgo: 2 },
    ]);
  });

  it("squeeze activo → candidato 'squeeze' con direction 'neutral'", () => {
    const p = basePayload({
      cross_info: { happened: false, candles_since_cross: null, direction: null, window: 10 },
      macd_cross: null,
      stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null },
      bollinger_squeeze: { is_squeezed: true, threshold_pct: 3, bandwidth: 2.1 },
    });
    const out = collectCrossCandidates(p);
    expect(out).toEqual([
      { symbol: "BTCUSDT", type: "squeeze", direction: "neutral", price: 80468.63, candlesAgo: 0 },
    ]);
  });

  it("spot_price null → lista vacía (no hay precio que registrar)", () => {
    const out = collectCrossCandidates(basePayload({ spot_price: null }));
    expect(out).toEqual([]);
  });

  it("payload sin cruces fresh → lista vacía", () => {
    const out = collectCrossCandidates(basePayload({
      cross_info: { happened: false, candles_since_cross: null, direction: null, window: 10 },
      macd_cross: { happened: false, candles_since_cross: null, direction: null, momentum_flip: false, momentum_flip_direction: null, candles_since_flip: null, window: 6 },
      stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null },
    }));
    expect(out).toEqual([]);
  });

  it("top-level nulls (cross_info=null, macd_cross=null, stoch_cross=null) → 0 candidatos y sin throw", () => {
    const out = collectCrossCandidates(basePayload({ cross_info: null, macd_cross: null, stoch_cross: null }));
    expect(out).toEqual([]);
  });
});
