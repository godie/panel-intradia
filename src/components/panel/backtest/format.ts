/**
 * format.ts — pure formatting helpers shared by BacktestModal and the
 * dedicated /backtest page components. Moved VERBATIM from
 * src/components/panel/backtest-modal.tsx (no logic changes).
 */

/** Format a USD value compactly (e.g., 12345 → "12,345" or 1234567 → "1.23M"). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Format a candle timestamp as a compact date (YYYY-MM-DD). */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format a price with the right precision based on its magnitude. */
export function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
