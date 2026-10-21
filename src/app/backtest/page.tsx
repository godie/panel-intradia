"use client";

import { useState } from "react";
import { BarChart3, Home } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import TabRun from "@/components/panel/backtest/tab-run";
import TabCompare from "@/components/panel/backtest/tab-compare";
import TabHistory from "@/components/panel/backtest/tab-history";

type TabId = "run" | "compare" | "history";

/**
 * Página dedicada de backtesting (server-driven): wrapper thin client.
 * Cada tab es su propio componente en src/components/panel/backtest/.
 */
export default function BacktestPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<TabId>("run");

  const TABS: { id: TabId; label: string }[] = [
    { id: "run", label: t("backtestUI.tabRun") },
    { id: "compare", label: t("backtestUI.tabCompare") },
    { id: "history", label: t("backtestUI.tabHistory") },
  ];

  return (
    <main className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-[#4fa8d8]" aria-hidden />
          <span className="text-sm font-semibold">{t("backtestUI.title")}</span>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        >
          <Home className="h-3.5 w-3.5" aria-hidden />
          {t("backtestUI.title")}
        </a>
      </header>

      <div
        className="flex gap-2 border-b border-white/10 px-4 py-2"
        role="tablist"
        aria-label={t("backtestUI.title")}
      >
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8] ${
              tab === tb.id
                ? "bg-[#4fa8d8]/15 text-[#4fa8d8]"
                : "text-foreground/60 hover:bg-white/5"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="flex-1 px-4 py-4">
        {tab === "run" && <TabRun />}
        {tab === "compare" && <TabCompare />}
        {tab === "history" && <TabHistory />}
      </div>
    </main>
  );
}
