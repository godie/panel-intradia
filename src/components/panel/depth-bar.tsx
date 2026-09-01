"use client";

import { computeTopOfBook, type DepthSnapshot } from "@/hooks/use-order-book";
import { useLanguage } from "@/hooks/use-language";

type Props = {
  snapshot: DepthSnapshot | undefined;
  spotPrice: number | null;
  connected: boolean;
};

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtQty(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

/**
 * DepthBar — compact L2 order book visualization.
 *
 * Shows the top 8 bid and ask levels as horizontal bars around the spread:
 *
 *   asks (red, descending volume bars, price above spot)
 *   ─────── spread ───────
 *   bids (green, descending volume bars, price below spot)
 *
 * Plus a summary row with best bid/ask, spread (absolute + %), and the
 * bid/ask volume imbalance (a leading indicator of short-term direction).
 *
 * When the snapshot is missing or the socket is disconnected we show an
 * explicit "Order book no disponible" notice — never fabricated levels.
 */
export function DepthBar({ snapshot, spotPrice, connected }: Props) {
  const { t } = useLanguage();
  if (!connected || !snapshot || snapshot.bids.length === 0 || snapshot.asks.length === 0) {
    return (
      <div className="rounded-md border border-white/5 bg-black/20 px-3 py-2.5 text-center text-[11px] italic text-muted-foreground/60">
        Order book {connected ? t("depth.syncing").toLowerCase() : t("depth.notAvailable").toLowerCase()}
      </div>
    );
  }

  const tob = computeTopOfBook(snapshot);
  // Show top 8 levels on each side, already sorted by Binance.
  const bids = snapshot.bids.slice(0, 8);
  const asks = snapshot.asks.slice(0, 8).slice().reverse(); // best ask at bottom, near spread

  // Normalize bar widths against the max qty across both sides.
  const maxQty = Math.max(
    1e-9,
    ...bids.map((l) => l.qty),
    ...asks.map((l) => l.qty),
  );

  const imbalance = tob.imbalance ?? 0;
  const imbalancePct = Math.round(imbalance * 100);
  const imbalanceColor =
    imbalance > 0.1 ? "#5fbf8f" : imbalance < -0.1 ? "#e2604f" : "#e8b04b";
  const imbalanceLabel =
    imbalance > 0.1
      ? t("depth.buy")
      : imbalance < -0.1
        ? t("depth.sell")
        : t("depth.equilibrium");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Order Book · L2
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: imbalanceColor }}
        >
          {imbalanceLabel} {imbalancePct > 0 ? "+" : ""}
          {imbalancePct}%
        </span>
      </div>

      {/* Asks (sells) — displayed top-down with best ask at the bottom (near spread) */}
      <div className="space-y-[2px]">
        {asks.map((level, i) => {
          const widthPct = (level.qty / maxQty) * 100;
          return (
            <div
              key={`ask-${i}`}
              className="relative flex items-center justify-between overflow-hidden rounded-sm bg-[#e2604f]/[0.04] px-1.5 py-[1px]"
              title={`Ask ${i + 1}: ${level.qty} @ ${level.price}`}
            >
              <div
                className="absolute inset-y-0 right-0 bg-[#e2604f]/15"
                style={{ width: `${widthPct}%` }}
                aria-hidden
              />
              <span className="tnum relative z-10 text-[10px] text-[#e2604f]/90">
                {fmtPrice(level.price)}
              </span>
              <span className="tnum relative z-10 text-[10px] text-muted-foreground">
                {fmtQty(level.qty)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Spread row */}
      <div className="flex items-center justify-between border-y border-white/10 bg-black/30 px-1.5 py-1">
        <div className="flex items-baseline gap-1">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {t("depth.spread")}
          </span>
          <span className="tnum text-[10px] font-medium text-foreground/80">
            {tob.spread != null ? fmtPrice(tob.spread) : "—"}
          </span>
          {tob.spreadPct != null && (
            <span className="tnum text-[9px] text-muted-foreground/60">
              ({tob.spreadPct.toFixed(3)}%)
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            Mid
          </span>
          <span className="tnum text-[10px] font-medium text-foreground/80">
            {fmtPrice(tob.midPrice)}
          </span>
        </div>
      </div>

      {/* Bids (buys) — best bid at the top (near spread) */}
      <div className="space-y-[2px]">
        {bids.map((level, i) => {
          const widthPct = (level.qty / maxQty) * 100;
          return (
            <div
              key={`bid-${i}`}
              className="relative flex items-center justify-between overflow-hidden rounded-sm bg-[#5fbf8f]/[0.04] px-1.5 py-[1px]"
              title={`Bid ${i + 1}: ${level.qty} @ ${level.price}`}
            >
              <div
                className="absolute inset-y-0 right-0 bg-[#5fbf8f]/15"
                style={{ width: `${widthPct}%` }}
                aria-hidden
              />
              <span className="tnum relative z-10 text-[10px] text-[#5fbf8f]/90">
                {fmtPrice(level.price)}
              </span>
              <span className="tnum relative z-10 text-[10px] text-muted-foreground">
                {fmtQty(level.qty)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Volume summary */}
      <div className="grid grid-cols-2 gap-2 text-[10px] pt-0.5">
        <div className="rounded border border-[#5fbf8f]/20 bg-[#5fbf8f]/5 px-1.5 py-1">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {t("depth.volBid")}
          </div>
          <div className="tnum font-medium text-[#5fbf8f]">
            {fmtQty(tob.bidVolume)}
          </div>
        </div>
        <div className="rounded border border-[#e2604f]/20 bg-[#e2604f]/5 px-1.5 py-1">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {t("depth.volAsk")}
          </div>
          <div className="tnum font-medium text-[#e2604f]">
            {fmtQty(tob.askVolume)}
          </div>
        </div>
      </div>
    </div>
  );
}
