"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Zap, TrendingUp, TrendingDown } from "lucide-react";
import { SYMBOL_META } from "@/lib/types";

type CrossEvent = {
  id: string;
  symbol: string;
  type: "ema" | "macd" | "momentum";
  direction: "bullish" | "bearish";
  price: number;
  candlesAgo: number;
  detectedAt: string;
};

const POLL_MS = 60_000;
// Only fire toasts for events detected in the last 5 minutes — older events
// (from before the page loaded) are shown in the timeline, not as toasts.
const RECENT_WINDOW_MS = 5 * 60 * 1000;

const TYPE_LABELS: Record<CrossEvent["type"], string> = {
  ema: "EMA 55/200",
  macd: "MACD / Signal",
  momentum: "Giro momentum",
};

/**
 * useCrossAlerts — polls /api/cross-history every 60s and fires a toast
 * notification whenever a NEW cross event is detected (within the last 5
 * minutes) that hasn't been shown before.
 *
 * Dedup via a Set of seen event IDs stored in a ref — survives re-renders
 * but resets on page reload (acceptable: on reload, recent events show in
 * the timeline but don't spam toasts).
 */
export function useCrossAlerts(enabled: boolean = true) {
  const seenRef = useRef<Set<string>>(new Set());
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
        for (const ev of data.events) {
          // Skip already-shown events.
          if (seenRef.current.has(ev.id)) continue;
          seenRef.current.add(ev.id);

          // On the first poll, seed the seen set without firing toasts —
          // avoids spamming the user with all historical events on page load.
          if (firstRunRef.current) continue;

          const ageMs = now - new Date(ev.detectedAt).getTime();
          if (ageMs > RECENT_WINDOW_MS) continue; // too old, not a "live" alert

          fireToast(ev);
        }
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
  const color = bullish ? "#5fbf8f" : "#e2604f";
  const DirIcon = bullish ? TrendingUp : TrendingDown;
  const asset = SYMBOL_META[ev.symbol]?.asset ?? ev.symbol;
  const typeLabel = TYPE_LABELS[ev.type];
  const dirLabel = bullish ? "alcista" : "bajista";

  toast(
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
        style={{ borderColor: `${color}40`, background: `${color}12` }}
      >
        {ev.type === "momentum" ? (
          <Zap className="h-4 w-4" style={{ color }} />
        ) : (
          <DirIcon className="h-4 w-4" style={{ color }} />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-foreground">
          {asset} · cruce {typeLabel}
        </div>
        <div className="text-[11px]" style={{ color }}>
          {dirLabel.toUpperCase()} · hace {ev.candlesAgo} vela(s)
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
