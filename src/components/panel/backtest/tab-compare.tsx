"use client";

import { useLanguage } from "@/hooks/use-language";

/** Stub del tab Comparación — reemplazado por la implementación completa del Task 11. */
export default function TabCompare() {
  const { t } = useLanguage();
  return (
    <div className="rounded-lg border border-white/10 bg-[#11151c] p-6 text-sm text-muted-foreground">
      {t("backtestUI.tabCompare")}
    </div>
  );
}
