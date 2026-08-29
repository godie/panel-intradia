"use client";

import type { AnalysisResponse } from "@/lib/types";

/**
 * Export the current analysis data as a downloadable JSON file.
 * Constructs a snapshot object with all 5 pairs + a timestamp, then triggers
 * a browser download via a Blob + temporary anchor element.
 */
export function exportSnapshot(
  items: (AnalysisResponse | null)[],
  crossHistory?: unknown,
) {
  const snapshot = {
    exported_at: new Date().toISOString(),
    pairs: items,
    cross_history: crossHistory ?? null,
    meta: {
      source: "Panel Cuantitativo // Intradía",
      data_provider: "Binance public API",
      symbols: items.length,
    },
  };

  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.download = `panel-cuantitativo-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
