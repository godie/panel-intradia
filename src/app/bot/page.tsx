"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

type BotConfig = {
  id: string;
  symbol: string;
  initialCapital: number;
  equity: number;
  minConfidence: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldTicks: number;
  positionSizing: string;
  fixedFractionalPct: number;
  feeBps: number;
  isActive: boolean;
  lastTickAt: string | null;
};

type BotTrade = {
  id: string;
  symbol: string;
  action: "BUY" | "SHORT";
  status: "OPEN" | "CLOSED";
  entryPrice: number;
  entryTime: string;
  positionSizePct: number;
  confidence: number;
  decisionLabel: string;
  ticksOpen: number;
  exitPrice: number | null;
  exitTime: string | null;
  exitReason: "stop_loss" | "take_profit" | "max_hold" | "signal_exit" | null;
  pnl: number | null;
  pnlPct: number | null;
};

type BotState = {
  config: BotConfig;
  price: number | null;
  openTrade: BotTrade | null;
  unrealizedPnl: { pnl: number; pnlPct: number } | null;
  closedTrades: BotTrade[];
};

const ACTION_COLOR: Record<"BUY" | "SHORT", string> = {
  BUY: "#5fbf8f",
  SHORT: "#e2604f",
};

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : n >= 1
      ? n.toFixed(2)
      : n.toFixed(4);
}

type Draft = {
  symbol: string;
  initialCapital: string;
  minConfidence: string;
  stopLossPct: string;
  takeProfitPct: string;
  maxHoldTicks: string;
};

function draftFromConfig(config: BotConfig): Draft {
  return {
    symbol: config.symbol,
    initialCapital: String(config.initialCapital),
    minConfidence: String(config.minConfidence),
    stopLossPct: String(config.stopLossPct),
    takeProfitPct: String(config.takeProfitPct),
    maxHoldTicks: String(config.maxHoldTicks),
  };
}

export default function BotPage() {
  const { t } = useLanguage();
  const [state, setState] = useState<BotState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bot/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BotState = await res.json();
      setState(data);
      setDraft((prev) => prev ?? draftFromConfig(data.config));
      setLoadError(null);
    } catch {
      setLoadError(t("bot.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const runTick = async () => {
    setTicking(true);
    setActionError(null);
    try {
      const res = await fetch("/api/bot/tick", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Error");
    } finally {
      setTicking(false);
    }
  };

  const saveConfig = async () => {
    if (!draft) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/bot/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: draft.symbol,
          initialCapital: Number(draft.initialCapital),
          minConfidence: Number(draft.minConfidence),
          stopLossPct: Number(draft.stopLossPct),
          takeProfitPct: Number(draft.takeProfitPct),
          maxHoldTicks: Number(draft.maxHoldTicks),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState((prev) => (prev ? { ...prev, config: data.config } : prev));
      setDraft(draftFromConfig(data.config));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const hasOpenPosition = state?.openTrade != null;

  return (
    <div className="relative flex min-h-screen flex-col bg-background terminal-grid">
      <div className="terminal-scanlines pointer-events-none fixed inset-0 z-0" aria-hidden />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="border-b border-white/5 bg-card/40">
          <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {t("bot.title")}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("bot.subtitle")}</p>
              <p className="mt-1 text-[11px] text-[#e8b04b]">{t("bot.disclaimer")}</p>
            </div>

            <Link
              href="/"
              className="inline-flex items-center gap-1.5 self-start rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {t("bot.back")}
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {loadError && (
            <p className="rounded-lg border border-[#e2604f]/30 bg-[#e2604f]/10 px-4 py-3 text-sm text-[#e2604f]">
              {loadError}
            </p>
          )}
          {actionError && (
            <p className="rounded-lg border border-[#e2604f]/30 bg-[#e2604f]/10 px-4 py-3 text-sm text-[#e2604f]">
              {actionError}
            </p>
          )}

          {!state || !draft ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : (
            <>
              {/* Config */}
              <section className="rounded-xl border border-white/8 bg-card/60 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-foreground">{t("bot.config")}</h2>
                  <span className="text-[11px] text-muted-foreground/60">
                    {t("bot.lastTick")}:{" "}
                    {state.config.lastTickAt
                      ? new Date(state.config.lastTickAt).toLocaleString()
                      : t("bot.never")}
                  </span>
                </div>

                {hasOpenPosition && (
                  <p className="mb-3 text-[11px] text-muted-foreground/70">{t("bot.configLocked")}</p>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label={t("bot.symbol")}>
                    <input
                      type="text"
                      value={draft.symbol}
                      disabled={hasOpenPosition}
                      onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })}
                      className="tnum h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs uppercase text-foreground outline-none focus-visible:border-[#4fa8d8] disabled:opacity-50"
                    />
                  </Field>
                  <Field label={t("bot.budget")}>
                    <input
                      type="number"
                      value={draft.initialCapital}
                      disabled={hasOpenPosition}
                      onChange={(e) => setDraft({ ...draft, initialCapital: e.target.value })}
                      className="tnum h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs text-foreground outline-none focus-visible:border-[#4fa8d8] disabled:opacity-50"
                    />
                  </Field>
                  <Field label={t("bot.equity")}>
                    <div className="tnum flex h-8 items-center rounded-md border border-white/5 bg-black/10 px-2 text-xs text-foreground/80">
                      {fmtUsd(state.config.equity)}
                    </div>
                  </Field>
                  <Field label={t("bot.minConfidence")}>
                    <input
                      type="number"
                      value={draft.minConfidence}
                      onChange={(e) => setDraft({ ...draft, minConfidence: e.target.value })}
                      className="tnum h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs text-foreground outline-none focus-visible:border-[#4fa8d8]"
                    />
                  </Field>
                  <Field label={t("bot.stopLoss")}>
                    <input
                      type="number"
                      value={draft.stopLossPct}
                      onChange={(e) => setDraft({ ...draft, stopLossPct: e.target.value })}
                      className="tnum h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs text-foreground outline-none focus-visible:border-[#4fa8d8]"
                    />
                  </Field>
                  <Field label={t("bot.takeProfit")}>
                    <input
                      type="number"
                      value={draft.takeProfitPct}
                      onChange={(e) => setDraft({ ...draft, takeProfitPct: e.target.value })}
                      className="tnum h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs text-foreground outline-none focus-visible:border-[#4fa8d8]"
                    />
                  </Field>
                  <Field label={t("bot.maxHoldTicks")}>
                    <input
                      type="number"
                      value={draft.maxHoldTicks}
                      onChange={(e) => setDraft({ ...draft, maxHoldTicks: e.target.value })}
                      className="tnum h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs text-foreground outline-none focus-visible:border-[#4fa8d8]"
                    />
                  </Field>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveConfig}
                    disabled={saving}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#4fa8d8]/30 bg-[#4fa8d8]/10 px-3 text-xs font-medium text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? t("bot.saving") : t("bot.save")}
                  </button>
                  <button
                    type="button"
                    onClick={runTick}
                    disabled={ticking}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#5fbf8f]/30 bg-[#5fbf8f]/10 px-3 text-xs font-medium text-[#5fbf8f] transition-colors hover:bg-[#5fbf8f]/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden />
                    {ticking ? t("bot.running") : t("bot.runTick")}
                  </button>
                </div>
              </section>

              {/* Open position */}
              <section className="rounded-xl border border-white/8 bg-card/60 p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">{t("bot.position")}</h2>
                {!state.openTrade ? (
                  <p className="text-sm text-muted-foreground">{t("bot.noPosition")}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat
                      label={t("bot.symbol")}
                      value={
                        <span style={{ color: ACTION_COLOR[state.openTrade.action] }}>
                          {state.openTrade.symbol} · {t(`strategy.${state.openTrade.action.toLowerCase()}`)}
                        </span>
                      }
                    />
                    <Stat label={t("bot.entryPrice")} value={fmtPrice(state.openTrade.entryPrice)} />
                    <Stat label={t("bot.currentPrice")} value={fmtPrice(state.price)} />
                    <Stat
                      label={t("bot.unrealizedPnl")}
                      value={
                        <span
                          style={{
                            color:
                              (state.unrealizedPnl?.pnl ?? 0) >= 0 ? "#5fbf8f" : "#e2604f",
                          }}
                        >
                          {fmtUsd(state.unrealizedPnl?.pnl)} ({fmtPct(state.unrealizedPnl?.pnlPct)})
                        </span>
                      }
                    />
                    <Stat label={t("bot.ticksOpen")} value={String(state.openTrade.ticksOpen)} />
                    <Stat label={t("bot.confidence")} value={`${state.openTrade.confidence}%`} />
                  </div>
                )}
              </section>

              {/* History */}
              <section className="rounded-xl border border-white/8 bg-card/60 p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">{t("bot.history")}</h2>
                {state.closedTrades.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("bot.noHistory")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-white/8 text-left">
                          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            {t("bot.symbol")}
                          </th>
                          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            {t("bot.entryPrice")}
                          </th>
                          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            {t("bot.currentPrice")}
                          </th>
                          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            {t("bot.pnl")}
                          </th>
                          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            {t("bot.exitReason")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.closedTrades.map((trade) => (
                          <tr key={trade.id} className="border-b border-white/5">
                            <td className="px-3 py-2">
                              <span style={{ color: ACTION_COLOR[trade.action] }}>
                                {trade.symbol} · {t(`strategy.${trade.action.toLowerCase()}`)}
                              </span>
                            </td>
                            <td className="tnum px-3 py-2">{fmtPrice(trade.entryPrice)}</td>
                            <td className="tnum px-3 py-2">{fmtPrice(trade.exitPrice)}</td>
                            <td
                              className="tnum px-3 py-2"
                              style={{ color: (trade.pnl ?? 0) >= 0 ? "#5fbf8f" : "#e2604f" }}
                            >
                              {fmtUsd(trade.pnl)} ({fmtPct(trade.pnlPct)})
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {trade.exitReason ? t(`bot.exit.${trade.exitReason}`) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="tnum text-sm text-foreground">{value}</div>
    </div>
  );
}
