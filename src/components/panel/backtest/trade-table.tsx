"use client";

import type { BacktestTrade } from "@/lib/backtest";
import { useLanguage } from "@/hooks/use-language";
import { formatTime, formatPrice } from "./format";

type Props = {
  trades: BacktestTrade[];
  /** Tailwind max-height for the scroll container. Default: the modal's max-h-72. */
  maxHeightClass?: string;
};

const REASON_KEYS: Record<BacktestTrade["exitReason"], string> = {
  stop_loss: "backtest.reasonStopLoss",
  take_profit: "backtest.reasonTakeProfit",
  max_hold: "backtest.reasonMaxHold",
  signal_exit: "backtest.reasonSignalExit",
  end_of_data: "backtest.reasonEnd",
};

/**
 * TradeTable — closed trades as a scrollable table, extracted VERBATIM from
 * BacktestModal (same classes/colors; only parametrized the scroll height).
 * Includes the empty state ("no trades" message from i18n).
 */
export function TradeTable({ trades, maxHeightClass }: Props) {
  const { t } = useLanguage();

  if (trades.length === 0) {
    return (
      <div className="rounded-md border border-white/8 bg-background/30 p-6 text-center text-xs text-muted-foreground">
        {t("backtest.noTrades")}
      </div>
    );
  }

  return (
    <div
      className={`rounded-md border border-white/8 bg-background/30 ${
        maxHeightClass ?? "max-h-72"
      } overflow-y-auto custom-scrollbar`}
    >
      <table className="w-full text-[11px] font-mono">
        <thead className="sticky top-0 bg-card/95 backdrop-blur-sm">
          <tr className="text-left text-muted-foreground">
            <th className="px-2.5 py-1.5 font-medium">#</th>
            <th className="px-2.5 py-1.5 font-medium">{t("backtest.entry")}</th>
            <th className="px-2.5 py-1.5 font-medium">{t("backtest.exit")}</th>
            <th className="px-2.5 py-1.5 font-medium text-right">{t("backtest.price")}</th>
            <th className="px-2.5 py-1.5 font-medium text-right">{t("backtest.pnl")}</th>
            <th className="px-2.5 py-1.5 font-medium text-right">{t("backtest.hold")}</th>
            <th className="px-2.5 py-1.5 font-medium">{t("backtest.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((tr, idx) => {
            const positive = tr.pnl >= 0;
            return (
              <tr
                key={idx}
                className="border-t border-white/5 hover:bg-white/3"
              >
                <td className="px-2.5 py-1.5 text-muted-foreground">
                  {idx + 1}
                </td>
                <td className="px-2.5 py-1.5 text-foreground/80">
                  {formatTime(tr.entryTime)}
                </td>
                <td className="px-2.5 py-1.5 text-foreground/80">
                  {formatTime(tr.exitTime)}
                </td>
                <td className="px-2.5 py-1.5 text-right text-foreground/80">
                  {formatPrice(tr.entryPrice)} →{" "}
                  {formatPrice(tr.exitPrice)}
                </td>
                <td
                  className={`px-2.5 py-1.5 text-right font-semibold ${
                    positive ? "text-[#5fbf8f]" : "text-[#e2604f]"
                  }`}
                >
                  {positive ? "+" : ""}
                  {tr.pnlPct.toFixed(2)}%
                </td>
                <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                  {tr.holdCandles}
                </td>
                <td className="px-2.5 py-1.5 text-muted-foreground">
                  {t(REASON_KEYS[tr.exitReason])}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
