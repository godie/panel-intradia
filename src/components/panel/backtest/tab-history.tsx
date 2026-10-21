"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, Loader2, Trash2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import type { BacktestResult } from "@/lib/backtest";
import { EquityCurveCanvas } from "./equity-curve";
import { TradeTable } from "./trade-table";
import { formatPrice } from "./format";

type RunSummaryRow = {
  id: string;
  createdAt: string;
  symbol: string;
  interval: string;
  candles: number;
  strategyId: string | null;
  strategyName: string;
  isCustom: boolean;
  totalTrades: number;
  winRatePct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
};

type DetailPayload = {
  run: RunSummaryRow & { config: string };
  result: BacktestResult;
  truncation: { originalTrades: number; keptTrades: number } | null;
};

function safeDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Tab Historial — corridas persistidas en SQLite via /api/backtest/runs.
 * Lista con filtros (símbolo/estrategia), detalle read-only inline (curva +
 * trades, sin modal), borrado con confirm() nativo y export JSON.
 */
export default function TabHistory() {
  const { t } = useLanguage();
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterStrategyId, setFilterStrategyId] = useState("");
  const [runs, setRuns] = useState<RunSummaryRow[]>([]);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (filterSymbol.trim()) params.set("symbol", filterSymbol.trim().toUpperCase());
      if (filterStrategyId) params.set("strategyId", filterStrategyId);
      const res = await fetch(`/api/backtest/runs?${params.toString()}`);
      const json = (await res.json()) as { runs?: RunSummaryRow[]; error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? t("backtestUI.loadError"));
        setRuns([]);
      } else {
        setRuns(json.runs ?? []);
      }
    } catch {
      setError(t("backtestUI.loadError"));
    } finally {
      setLoading(false);
    }
  }, [filterSymbol, filterStrategyId, t]);

  useEffect(() => {
    void loadList();
  }, [loadList, reloadToken]);

  const loadDetail = async (id: string) => {
    setDetailLoading(true);
    setError(null);
    setDeleteMsg(null);
    try {
      const res = await fetch(`/api/backtest/runs/${id}`);
      const json = (await res.json()) as DetailPayload & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? t("backtestUI.loadError"));
        return;
      }
      setDetail(json);
    } catch {
      setError(t("backtestUI.loadError"));
    } finally {
      setDetailLoading(false);
    }
  };

  const deleteRun = async (id: string) => {
    if (!window.confirm(t("backtestUI.confirmDelete"))) return;
    try {
      const res = await fetch(`/api/backtest/runs/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDetail(null);
        setDeleteMsg(t("backtestUI.deletedMsg"));
        setReloadToken((v) => v + 1);
      } else {
        setError(t("backtestUI.loadError"));
      }
    } catch {
      setError(t("backtestUI.loadError"));
    }
  };

  const exportJson = () => {
    if (!detail) return;
    try {
      const blob = new Blob(
        [JSON.stringify({ run: detail.run, result: detail.result }, null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backtest-${detail.run.symbol}-${detail.run.strategyId ?? "custom"}-${detail.run.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("backtestUI.loadError"));
    }
  };

  if (detail) {
    return (
      <DetailReadonly
        detail={detail}
        onBack={() => setDetail(null)}
        onDelete={() => void deleteRun(detail.run.id)}
        onExport={exportJson}
        deleteMsg={deleteMsg}
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-[#E2604F]/40 bg-[#E2604F]/10 px-3 py-2 text-xs text-[#E2604F]"
        >
          {error}
        </div>
      )}
      {deleteMsg && (
        <p className="text-[11px] text-muted-foreground">{deleteMsg}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filterSymbol}
          onChange={(e) => setFilterSymbol(e.target.value)}
          aria-label={t("backtestUI.filterSymbol")}
          placeholder="BTCUSDT"
          className="w-40 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs font-mono focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        />
        <select
          value={filterStrategyId}
          onChange={(e) => setFilterStrategyId(e.target.value)}
          aria-label={t("backtestUI.strategy")}
          className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        >
          <option value="" className="bg-[#11151c]">
            {t("backtestUI.filterAll")}
          </option>
          {runs
            .map((r) => r.strategyId)
            .filter((id): id is string => id != null)
            .filter((id, i, arr) => arr.indexOf(id) === i)
            .map((id) => (
              <option key={id} value={id} className="bg-[#11151c]">
                {id}
              </option>
            ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : runs.length === 0 && !error ? (
        <div className="rounded-lg border border-white/10 bg-[#11151c] p-10 text-center text-sm text-muted-foreground">
          {t("backtestUI.emptyHistory")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#11151c] custom-scrollbar">
          <table className="w-full text-[11px] font-mono">
            <thead className="sticky top-0 bg-card/95 backdrop-blur-sm">
              <tr className="text-left text-muted-foreground">
                <th className="px-2.5 py-2 font-medium">{t("backtestUI.colDate")}</th>
                <th className="px-2.5 py-2 font-medium">{t("backtest.symbol")}</th>
                <th className="px-2.5 py-2 font-medium">{t("backtestUI.strategy")}</th>
                <th className="px-2.5 py-2 text-right font-medium">{t("backtest.totalTrades")}</th>
                <th className="px-2.5 py-2 text-right font-medium">{t("backtest.winRate")}</th>
                <th className="px-2.5 py-2 text-right font-medium">{t("backtest.totalReturn")}</th>
                <th className="px-2.5 py-2 text-right font-medium">{t("backtest.maxDrawdown")}</th>
                <th className="px-2.5 py-2 font-medium" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => void loadDetail(r.id)}
                  className="cursor-pointer border-t border-white/5 hover:bg-white/3"
                >
                  <td className="px-2.5 py-2 text-muted-foreground">{safeDate(r.createdAt)}</td>
                  <td className="px-2.5 py-2 text-foreground/85">
                    {r.symbol}
                    <span className="ml-1.5 text-[9px] uppercase text-muted-foreground/60">
                      {r.interval}/{r.candles}
                    </span>
                  </td>
                  <td className="px-2.5 py-2 text-foreground/85">
                    {r.strategyName}
                    {r.isCustom && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider text-muted-foreground/60">
                        custom
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-2 text-right text-foreground/80">{r.totalTrades}</td>
                  <td className="px-2.5 py-2 text-right text-foreground/80">
                    {r.winRatePct.toFixed(0)}%
                  </td>
                  <td
                    className={`px-2.5 py-2 text-right font-semibold ${
                      r.totalReturnPct >= 0 ? "text-[#5fbf8f]" : "text-[#e2604f]"
                    }`}
                  >
                    {r.totalReturnPct >= 0 ? "+" : ""}
                    {r.totalReturnPct.toFixed(2)}%
                  </td>
                  <td className="px-2.5 py-2 text-right text-foreground/80">
                    {r.maxDrawdownPct.toFixed(2)}%
                  </td>
                  <td className="px-2.5 py-2 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteRun(r.id);
                      }}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-[#E2604F]/15 hover:text-[#E2604F] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
                      aria-label={t("backtestUI.deleteBtn")}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Vista detalle read-only (curva + trades + acciones), sin modal. */
function DetailReadonly({
  detail,
  onBack,
  onDelete,
  onExport,
  deleteMsg,
}: {
  detail: DetailPayload;
  onBack: () => void;
  onDelete: () => void;
  onExport: () => void;
  deleteMsg: string | null;
}) {
  const { t } = useLanguage();
  const { run, result, truncation } = detail;
  const stats = result.stats;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t("backtestUI.backBtn")}
        </button>
        <div className="flex items-center gap-2">
          {deleteMsg && (
            <span className="text-[11px] text-muted-foreground">{deleteMsg}</span>
          )}
          <button
            type="button"
            onClick={onExport}
            aria-label={t("backtestUI.exportBtn")}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#4fa8d8]/40 bg-[#4fa8d8]/10 px-3 py-1.5 text-xs text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t("backtestUI.exportBtn")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E2604F]/40 bg-[#E2604F]/10 px-3 py-1.5 text-xs text-[#E2604F] transition-colors hover:bg-[#E2604F]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {t("backtestUI.deleteBtn")}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#11151c] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-semibold text-foreground">
            {run.strategyName}
          </span>
          {run.isCustom && (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
              custom
            </span>
          )}
          <span className="text-muted-foreground">
            {run.symbol} · {run.interval} · {run.candles} ·{" "}
            {safeDate(run.createdAt)}
          </span>
        </div>
        {truncation && (
          <p className="mt-1 text-[10px] text-[#E8B04B]">
            {t("backtestUI.truncatedBadge")
              .replace("{kept}", String(truncation.keptTrades))
              .replace("{total}", String(truncation.originalTrades))}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            { key: "backtest.totalTrades", val: String(stats.totalTrades) },
            { key: "backtest.winRate", val: `${stats.winRate.toFixed(1)}%` },
            { key: "backtest.totalReturn", val: `${stats.totalReturnPct >= 0 ? "+" : ""}${stats.totalReturnPct.toFixed(2)}%` },
            { key: "backtest.maxDrawdown", val: `${stats.maxDrawdownPct.toFixed(2)}%` },
          ] as const
        ).map((m) => (
          <div
            key={m.key}
            className="rounded-md border border-white/8 bg-[#11151c] px-3 py-2"
          >
            <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t(m.key)}
            </div>
            <div
              className={`mt-0.5 font-mono text-sm ${
                m.key === "backtest.totalReturn"
                  ? Number(stats.totalReturnPct) >= 0
                    ? "text-[#5FBF8F]"
                    : "text-[#E2604F]"
                  : "text-foreground"
              }`}
            >
              {m.val}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/10 bg-[#11151c] p-4">
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("backtest.equityCurve")}
        </h4>
        <EquityCurveCanvas
          result={result}
          className="w-full h-64 rounded-md border border-white/8 bg-background/40 md:h-80"
          ariaLabel={t("backtest.equityCurve")}
        />
        <p className="mt-2 text-[10px] text-muted-foreground">
          {t("backtest.candlesAnalyzed")}: {result.candlesAnalyzed} ·{" "}
          {t("backtest.provider")}: {result.provider} ·{" "}
          {t("backtest.finalEquity")}: ${formatPrice(stats.finalEquity)}
        </p>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#11151c] p-4">
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("backtest.trades")}{" "}
          <span className="font-normal text-muted-foreground/60">
            ({result.trades.length})
          </span>
        </h4>
        <TradeTable trades={result.trades} maxHeightClass="max-h-[60vh]" />
      </div>
    </div>
  );
}
