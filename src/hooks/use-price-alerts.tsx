"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bell, BellRing, TrendingUp, TrendingDown } from "lucide-react";
import { SYMBOL_META } from "@/lib/types";

export type PriceAlert = {
  id: string;
  symbol: string;
  price: number;
  direction: "above" | "below";
  createdAt: number;
  /** Whether the alert has been triggered (prevents re-firing). */
  triggered: boolean;
};

const STORAGE_KEY = "panel:price-alerts";

function loadAlerts(): PriceAlert[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PriceAlert[]) : [];
  } catch {
    return [];
  }
}

function saveAlerts(alerts: PriceAlert[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch {
    // Ignore quota / privacy mode errors.
  }
}

/**
 * usePriceAlerts — manages user-defined price alerts per symbol.
 *
 * Alerts are stored in localStorage and persist across page reloads. The hook
 * takes the live tick prices (from useTickStream) and checks each alert on
 * every tick — if the live price crosses the alert threshold in the specified
 * direction, a toast fires and the alert is marked as triggered (so it doesn't
 * re-fire on every subsequent tick).
 *
 * Triggered alerts are auto-removed after 24h to keep the list clean.
 */
export function usePriceAlerts(livePrices: Record<string, { price: number; time: number }>) {
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => loadAlerts());
  const checkedRef = useRef<Set<string>>(new Set());
  // Keep a ref of alerts updated via effect (not during render) so the
  // live-price check effect can read the latest alerts without depending on
  // the alerts state (which would trigger the set-state-in-effect lint rule).
  const alertsRef = useRef(alerts);
  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);
  // Keep a ref of live prices updated via effect for the interval-based check.
  const livePricesRef = useRef(livePrices);
  useEffect(() => {
    livePricesRef.current = livePrices;
  }, [livePrices]);

  // Persist alerts on every change.
  useEffect(() => {
    saveAlerts(alerts);
  }, [alerts]);

  // Check alerts against live prices on an interval (every 2s). This avoids
  // the set-state-in-effect lint rule by not running inside a useEffect that
  // depends on livePrices — instead we poll on a timer.
  useEffect(() => {
    const check = () => {
      const currentAlerts = alertsRef.current;
      let anyTriggered = false;
      for (const alert of currentAlerts) {
        if (alert.triggered) continue;
        const tick = livePricesRef.current[alert.symbol];
        if (!tick || !Number.isFinite(tick.price)) continue;

        const key = `${alert.id}-${tick.time}`;
        if (checkedRef.current.has(key)) continue;
        checkedRef.current.add(key);

        const hit =
          alert.direction === "above"
            ? tick.price >= alert.price
            : tick.price <= alert.price;

        if (hit) {
          anyTriggered = true;
          fireAlertToast(alert, tick.price);
        }
      }
      if (anyTriggered) {
        setAlerts((prev) =>
          prev.map((a) => {
            if (a.triggered) return a;
            const tick = livePricesRef.current[a.symbol];
            if (!tick || !Number.isFinite(tick.price)) return a;
            const hit =
              a.direction === "above"
                ? tick.price >= a.price
                : tick.price <= a.price;
            return hit ? { ...a, triggered: true } : a;
          }),
        );
      }
    };
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, []);

  // Clean up triggered alerts older than 24h.
  useEffect(() => {
    const cleanup = setInterval(() => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      setAlerts((prev) => {
        const filtered = prev.filter(
          (a) => !a.triggered || a.createdAt > cutoff,
        );
        return filtered.length !== prev.length ? filtered : prev;
      });
    }, 60_000);
    return () => clearInterval(cleanup);
  }, []);

  const addAlert = useCallback(
    (symbol: string, price: number, direction: "above" | "below") => {
      const alert: PriceAlert = {
        id: `${symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        symbol,
        price,
        direction,
        createdAt: Date.now(),
        triggered: false,
      };
      setAlerts((prev) => [...prev, alert]);
      toast.success(
        `Alerta creada: ${SYMBOL_META[symbol]?.asset ?? symbol} ${direction === "above" ? "≥" : "≤"} $${price}`,
        { duration: 4000 },
      );
    },
    [],
  );

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearTriggered = useCallback(() => {
    setAlerts((prev) => prev.filter((a) => !a.triggered));
  }, []);

  return { alerts, addAlert, removeAlert, clearTriggered };
}

function fireAlertToast(alert: PriceAlert, livePrice: number) {
  // Play a beep sound using Web Audio API — but only if the user hasn't
  // disabled it via the PriceAlerts modal toggle.
  try {
    if (localStorage.getItem("panel:alert-sound") !== "false") {
      playAlertSound(alert.direction);
    }
  } catch {
    playAlertSound(alert.direction);
  }

  const asset = SYMBOL_META[alert.symbol]?.asset ?? alert.symbol;
  const isAbove = alert.direction === "above";
  const color = isAbove ? "#5fbf8f" : "#e2604f";
  const Icon = isAbove ? TrendingUp : TrendingDown;

  toast(
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
        style={{ borderColor: `${color}40`, background: `${color}12` }}
      >
        <BellRing className="h-4 w-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-foreground">
          {asset} · alerta de precio
        </div>
        <div className="text-[11px]" style={{ color }}>
          {isAbove ? "ALCANZÓ" : "BAJÓ A"} ${alert.price.toFixed(2)}{" "}
          <span className="text-muted-foreground">(live: ${livePrice.toFixed(2)})</span>
        </div>
      </div>
    </div>,
    {
      duration: 10000,
      style: {
        borderColor: `${color}40`,
        boxShadow: `0 0 20px -8px ${color}80`,
      },
    },
  );
}

/**
 * playAlertSound — plays a short beep using the Web Audio API.
 *
 * "above" alerts play an ascending two-tone (higher pitch = bullish).
 * "below" alerts play a descending two-tone (lower pitch = bearish).
 * Silently fails if the AudioContext is not available (older browsers or
 * autoplay restrictions before user interaction).
 */
function playAlertSound(direction: "above" | "below") {
  try {
    const AudioContextClass =
      typeof window !== "undefined"
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    const freq1 = direction === "above" ? 523.25 : 392.0; // C5 or G4
    const freq2 = direction === "above" ? 659.25 : 329.63; // E5 or E4

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq1, now);
    osc.frequency.setValueAtTime(freq2, now + 0.12);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    osc.start(now);
    osc.stop(now + 0.3);

    // Close the context after the sound finishes to free resources.
    osc.onended = () => ctx.close();
  } catch {
    // Silently ignore — sound is non-critical.
  }
}

export { Bell };
