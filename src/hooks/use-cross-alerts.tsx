"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Zap, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { SYMBOL_META } from "@/lib/types";

type CrossEvent = {
  id: string;
  symbol: string;
  type: "ema" | "macd" | "momentum" | "squeeze" | "squeeze_breakout";
  direction: "bullish" | "bearish" | "neutral";
  price: number;
  candlesAgo: number;
  detectedAt: string;
};

const POLL_MS = 60_000;
// Only fire toasts for events detected in the last 5 minutes — older events
// (from before the page loaded) are shown in the timeline, not as toasts.
const RECENT_WINDOW_MS = 5 * 60 * 1000;
const STORAGE_KEY = "panel:seen-alerts";

const TYPE_LABELS: Record<CrossEvent["type"], string> = {
  ema: "EMA 55/200",
  macd: "MACD / Signal",
  momentum: "Giro momentum",
  squeeze: "Bollinger Squeeze",
  squeeze_breakout: "Squeeze Breakout",
};

/**
 * Load the set of already-shown event IDs from sessionStorage.
 * Survives page reloads within the same browser session — prevents re-firing
 * toasts for events the user has already seen. Cleared when the tab closes.
 */
function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

/** Persist the seen set back to sessionStorage (capped to last 200 IDs). */
function saveSeen(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    // Keep only the most recent 200 to avoid unbounded growth.
    const arr = [...set].slice(-200);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // Ignore quota / privacy mode errors.
  }
}

/**
 * useCrossAlerts — polls /api/cross-history every 60s and fires a toast
 * notification whenever a NEW cross event is detected (within the last 5
 * minutes) that hasn't been shown before.
 *
 * Dedup via sessionStorage: the set of seen event IDs persists across page
 * reloads within the same browser session. On the first poll after load,
 * recent events are seeded into the set WITHOUT firing toasts (so reloading
 * doesn't re-notify for already-seen events). New events detected in
 * subsequent polls fire toasts.
 */
export function useCrossAlerts(enabled: boolean = true) {
  const seenRef = useRef<Set<string>>(loadSeen());
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (!enabled) return;

    const check = async () => {
      try {
        const res = await fetch("/api/cross-history?limit=20", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { events: CrossEvent[] };
        if (!data.events || !Array.isArray(data.events)) return;

        const now = Date.now();
        let changed = false;
        for (const ev of data.events) {
          // Skip already-shown events.
          if (seenRef.current.has(ev.id)) continue;
          seenRef.current.add(ev.id);
          changed = true;

          // On the first poll, seed the seen set without firing toasts —
          // avoids spamming the user with all historical events on page load.
          if (firstRunRef.current) continue;

          const ageMs = now - new Date(ev.detectedAt).getTime();
          if (ageMs > RECENT_WINDOW_MS) continue; // too old, not a "live" alert

          fireToast(ev);
        }
        if (changed) saveSeen(seenRef.current);
        firstRunRef.current = false;
      } catch {
        // Silently ignore — alerts are non-critical.
      }
    };

    check();
    const id = setInterval(check, POLL_MS);
    return () => clearInterval(id);
  }, [enabled]);
}

function fireToast(ev: CrossEvent) {
  const bullish = ev.direction === "bullish";
  const isSqueeze = ev.type === "squeeze";
  // Squeeze uses purple; bullish green; bearish red; neutral (squeeze) purple.
  const color = isSqueeze
    ? "#b48cff"
    : bullish
      ? "#5fbf8f"
      : "#e2604f";
  const asset = SYMBOL_META[ev.symbol]?.asset ?? ev.symbol;
  const typeLabel = TYPE_LABELS[ev.type] ?? ev.type;
  const dirLabel = isSqueeze
    ? "compresión"
    : bullish
      ? "alcista"
      : "bajista";

  const Icon = isSqueeze ? Activity : bullish ? TrendingUp : TrendingDown;

  toast(
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
        style={{ borderColor: `${color}40`, background: `${color}12` }}
      >
        {ev.type === "momentum" || isSqueeze ? (
          <Icon className="h-4 w-4" style={{ color }} />
        ) : (
          <Icon className="h-4 w-4" style={{ color }} />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-foreground">
          {asset} · {typeLabel}
        </div>
        <div className="text-[11px]" style={{ color }}>
          {dirLabel.toUpperCase()}
          {ev.candlesAgo > 0 ? ` · hace ${ev.candlesAgo} vela(s)` : ""}
        </div>
      </div>
    </div>,
    {
      duration: 8000,
      style: {
        borderColor: `${color}40`,
        boxShadow: `0 0 20px -8px ${color}80`,
      },
    },
  );
}
