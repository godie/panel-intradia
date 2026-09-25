"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { computeConsensus } from "@/lib/consensus";
import { CONSENSUS_META } from "@/components/panel/strategy-consensus";
import { getSymbolMeta, type AnalysisResponse, type CrossState } from "@/lib/types";
import {
  COMPARE_PRESETS,
  DEFAULT_COMPARE_PRESET_ID,
  TIMEFRAME_LABEL_KEY,
  getPreset,
  type Timeframe,
} from "@/lib/timeframes";
import { DEFAULT_WATCHLIST, loadWatchlist } from "@/lib/symbol-manager";
import { useLanguage } from "@/hooks/use-language";
import { ArrowLeft, Zap } from "lucide-react";

/** Cells are keyed "SYMBOL:tf" — same convention as the dashboard. */
function cellKey(symbol: string, tf: Timeframe): string {
  return `${symbol}:${tf}`;
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

const STATE_KEY: Record<CrossState, { key: string; color: string }> = {
  ALCISTA: { key: "card.stateAlcista", color: "#5fbf8f" },
  BAJISTA: { key: "card.stateBajista", color: "#e2604f" },
  COMPRIMIDO: { key: "card.stateComprimido", color: "#e8b04b" },
};

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground/60">{label}</span>
      <span className="tnum font-medium" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

/**
 * CompareCell — one symbol on one timeframe: consensus action plus the key
 * indicators behind it. `undefined` = still loading, `null` = fetch failed.
 */
function CompareCell({ data }: { data: AnalysisResponse | null | undefined }) {
  const { t } = useLanguage();

  if (data === undefined) {
    return <span className="text-xs text-muted-foreground/40">…</span>;
  }
  if (data === null) {
    return (
      <span className="text-xs italic text-muted-foreground/50">
        {t("compare.na")}
      </span>
    );
  }

  const { level, avgConfidence } = computeConsensus(data);
  const meta = CONSENSUS_META[level];
  const state = data.cross_state ? STATE_KEY[data.cross_state] : null;
  const nd = data.no_disponible;
  // Labels carrying the interval ("… · {tf}") use THIS cell's timeframe.
  const tfLabel = t(TIMEFRAME_LABEL_KEY[data.timeframe]);
  const freshCross =
    data.cross_info?.happened === true || data.macd_cross?.happened === true;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.bg}`}
          style={{ color: meta.color }}
          title={t("compare.consensus")}
        >
          {meta.label}
        </span>
        <span className="tnum text-[10px] text-muted-foreground/70">
          {avgConfidence}%
        </span>
        {freshCross && (
          <Zap
            className="h-3 w-3 text-[#e8b04b]"
            aria-label={t("compare.recentCross")}
          />
        )}
      </div>

      <Metric
        label={t("compare.emaState")}
        value={state ? t(state.key) : t("compare.na")}
        color={state?.color}
      />
      <Metric
        label={t("compare.price")}
        value={`$${fmtPrice(data.spot_price)}`}
      />
      <Metric
        label={t("card.rsi").replace("{tf}", tfLabel)}
        value={nd.rsi_14 || data.rsi_14 == null ? t("compare.na") : data.rsi_14.toFixed(1)}
        color={
          data.rsi_14 == null
            ? undefined
            : data.rsi_14 >= 70
              ? "#e2604f"
              : data.rsi_14 <= 30
                ? "#5fbf8f"
                : undefined
        }
      />
      <Metric
        label={`${t("card.ema55")} / ${t("card.ema200")}`}
        value={`${fmtPrice(data.ema55)} / ${fmtPrice(data.ema200)}`}
      />
      <Metric
        label={t("card.macd").replace("{tf}", tfLabel)}
        value={fmtPrice(data.macd.histogram)}
        color={
          data.macd.histogram == null
            ? undefined
            : data.macd.histogram >= 0
              ? "#5fbf8f"
              : "#e2604f"
        }
      />
      <Metric
        label={t("card.atr").replace("{tf}", tfLabel)}
        value={`$${fmtPrice(data.atr_14)}`}
      />
    </div>
  );
}

export default function ComparePage() {
  const { t } = useLanguage();
  const router = useRouter();

  // Watchlist — defaults on the server, stored list adopted after mount (the
  // first client render must match the SSR HTML, same rule as the dashboard).
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
  useEffect(() => {
    setSymbols(loadWatchlist());
  }, []);

  // Preset from the URL, read after mount for the same hydration reason.
  const [presetId, setPresetId] = useState<string>(DEFAULT_COMPARE_PRESET_ID);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("preset");
    if (getPreset(fromUrl)) setPresetId(fromUrl as string);
  }, []);
  const preset = getPreset(presetId) ?? getPreset(DEFAULT_COMPARE_PRESET_ID)!;

  // Analysis payloads keyed "SYMBOL:tf". A missing entry means "loading".
  const [cells, setCells] = useState<
    Record<string, AnalysisResponse | null | undefined>
  >({});

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    const targets: [string, Timeframe][] = symbols.flatMap((s) => [
      [s, preset.a],
      [s, preset.b],
    ]);

    void Promise.all(
      targets.map(async ([symbol, tf]) => {
        try {
          const res = await fetch(`/api/analysis?symbol=${symbol}&tf=${tf}`, {
            signal: ac.signal,
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as AnalysisResponse;
          if (cancelled) return;
          setCells((prev) => ({ ...prev, [cellKey(symbol, tf)]: data }));
        } catch {
          if (cancelled) return;
          setCells((prev) => ({ ...prev, [cellKey(symbol, tf)]: null }));
        }
      }),
    );

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [symbols, preset.a, preset.b]);

  const selectPreset = (id: string) => {
    setPresetId(id);
    router.replace(`/comparar?preset=${id}`);
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-background terminal-grid">
      <div className="terminal-scanlines pointer-events-none fixed inset-0 z-0" aria-hidden />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* No `backdrop-blur` here — see the note in app/page.tsx: it would
            make this header a containing block for any fixed descendant. */}
        <header className="border-b border-white/5 bg-card/40">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {t("compare.title")}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("compare.subtitle")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
                {t("compare.preset")}
              </span>
              <div
                role="group"
                aria-label={t("compare.preset")}
                className="inline-flex items-center gap-0.5 rounded-md border border-white/8 bg-black/20 p-0.5"
              >
                {COMPARE_PRESETS.map((p) => {
                  const active = p.id === preset.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectPreset(p.id)}
                      aria-pressed={active}
                      className={`rounded px-2 py-1 text-[11px] font-semibold tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#4fa8d8] ${
                        active
                          ? "bg-[#4fa8d8]/15 text-[#4fa8d8]"
                          : "text-muted-foreground/60 hover:bg-white/10 hover:text-foreground/80"
                      }`}
                    >
                      {t(TIMEFRAME_LABEL_KEY[p.a])} ↔ {t(TIMEFRAME_LABEL_KEY[p.b])}
                    </button>
                  );
                })}
              </div>

              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                {t("compare.back")}
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {symbols.length === 0 ? (
            <p className="rounded-xl border border-white/8 bg-card/40 p-8 text-center text-sm text-muted-foreground">
              {t("compare.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/8 bg-card/60">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/8 text-left">
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {t("compare.asset")}
                    </th>
                    {[preset.a, preset.b].map((tf) => (
                      <th
                        key={tf}
                        className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                      >
                        {t(TIMEFRAME_LABEL_KEY[tf])}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {symbols.map((symbol) => {
                    const meta = getSymbolMeta(symbol);
                    return (
                      <tr
                        key={symbol}
                        className="border-b border-white/5 last:border-0 align-top"
                      >
                        <th
                          scope="row"
                          className="px-4 py-3 text-left font-medium text-foreground"
                        >
                          {meta.pair}
                          <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/60">
                            {meta.label}
                          </span>
                        </th>
                        {[preset.a, preset.b].map((tf) => (
                          <td key={tf} className="px-4 py-3">
                            <CompareCell data={cells[cellKey(symbol, tf)]} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>

        <footer className="mt-auto border-t border-white/8 bg-black/50">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-center text-[11px] sm:px-6 md:flex-row md:items-center md:justify-between md:text-left lg:px-8">
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground/80">
                {t("footer.name")}
              </span>{" "}
              — {t("footer.tagline")}
            </p>
            <p className="font-medium text-foreground/70">
              {t("footer.disclaimer")}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
