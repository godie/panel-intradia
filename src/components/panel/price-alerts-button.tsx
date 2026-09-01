"use client";

import { useState } from "react";
import { Bell, X, Plus, Trash2, Check, Volume2, VolumeX } from "lucide-react";
import { SYMBOL_META, SYMBOLS, type PriceAlert } from "@/lib/types";

type Props = {
  alerts: PriceAlert[];
  onAdd: (symbol: string, price: number, direction: "above" | "below") => void;
  onRemove: (id: string) => void;
  onClearTriggered: () => void;
  livePrices: Record<string, { price: number; time: number }>;
};

/**
 * PriceAlertsButton — header button that opens a modal for managing price
 * alerts. Shows a badge with the count of active (non-triggered) alerts.
 *
 * The modal lets the user:
 *  - Create a new alert (symbol + price + direction above/below)
 *  - View all alerts (active + triggered)
 *  - Delete individual alerts
 *  - Clear all triggered alerts
 */
export function PriceAlertsButton({
  alerts,
  onAdd,
  onRemove,
  onClearTriggered,
  livePrices,
}: Props) {
  const [open, setOpen] = useState(false);
  const [newSymbol, setNewSymbol] = useState<string>("BTCUSDT");
  const [newPrice, setNewPrice] = useState<string>("");
  const [newDirection, setNewDirection] = useState<"above" | "below">("below");
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem("panel:alert-sound") !== "false";
    } catch {
      return true;
    }
  });

  const handleToggleSound = () => {
    const newVal = !soundEnabled;
    setSoundEnabled(newVal);
    try {
      localStorage.setItem("panel:alert-sound", String(newVal));
    } catch {
      // ignore
    }
  };

  const activeCount = alerts.filter((a) => !a.triggered).length;

  const handleAdd = () => {
    const price = Number(newPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    onAdd(newSymbol, price, newDirection);
    setNewPrice("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        aria-label="Alertas de precio"
        title="Gestionar alertas de precio"
      >
        <Bell className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">Alertas</span>
        {activeCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#4fa8d8] px-1 text-[9px] font-bold text-black">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-card-enter"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Alertas de precio"
        >
          <div
            className="relative w-full max-w-md mx-4 rounded-xl border border-white/10 bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/8 p-4">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-[#4fa8d8]" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">
                  Alertas de Precio
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* Create new alert */}
            <div className="border-b border-white/5 p-4">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                Crear alerta
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
                >
                  {SYMBOLS.map((s) => (
                    <option key={s} value={s} className="bg-card">
                      {SYMBOL_META[s]?.asset ?? s}
                    </option>
                  ))}
                </select>
                <select
                  value={newDirection}
                  onChange={(e) => setNewDirection(e.target.value as "above" | "below")}
                  className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
                >
                  <option value="below" className="bg-card">baja de</option>
                  <option value="above" className="bg-card">sube a</option>
                </select>
                <input
                  type="number"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="precio"
                  className="w-24 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!newPrice || Number(newPrice) <= 0}
                  className="inline-flex items-center gap-1 rounded-md border border-[#4fa8d8]/30 bg-[#4fa8d8]/10 px-2.5 py-1.5 text-xs font-medium text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  Crear
                </button>
              </div>
              {/* Quick fill with current price */}
              {livePrices[newSymbol] && (
                <button
                  type="button"
                  onClick={() =>
                    setNewPrice(livePrices[newSymbol].price.toFixed(2))
                  }
                  className="mt-1.5 text-[10px] text-muted-foreground/60 hover:text-foreground/80"
                >
                  Usar precio actual: ${livePrices[newSymbol].price.toFixed(2)}
                </button>
              )}
            </div>

            {/* Alerts list */}
            <div className="max-h-72 overflow-y-auto scroll-thin p-4">
              {alerts.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/60">
                  Sin alertas configuradas. Crea una arriba para recibir
                  notificaciones cuando el precio alcance tu objetivo.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {alerts.map((alert) => {
                    const live = livePrices[alert.symbol]?.price;
                    const dist = live != null
                      ? ((alert.price - live) / live) * 100
                      : null;
                    return (
                      <li
                        key={alert.id}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                          alert.triggered
                            ? "border-[#5fbf8f]/20 bg-[#5fbf8f]/5 opacity-60"
                            : "border-white/8 bg-black/15"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground">
                              {SYMBOL_META[alert.symbol]?.asset ?? alert.symbol}
                            </span>
                            <span
                              className={alert.direction === "above" ? "text-[#5fbf8f]" : "text-[#e2604f]"}
                            >
                              {alert.direction === "above" ? "≥" : "≤"}
                            </span>
                            <span className="tnum font-medium text-foreground">
                              ${alert.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </span>
                            {alert.triggered && (
                              <Check className="h-3 w-3 text-[#5fbf8f]" aria-hidden />
                            )}
                          </div>
                          {dist != null && !alert.triggered && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                              {dist > 0 ? "+" : ""}{dist.toFixed(2)}% del precio actual
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemove(alert.id)}
                          className="rounded p-1 text-muted-foreground/50 transition-colors hover:bg-white/10 hover:text-[#e2604f]"
                          aria-label="Eliminar alerta"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer with sound toggle + clear triggered */}
            <div className="flex items-center gap-2 border-t border-white/5 p-3">
              <button
                type="button"
                onClick={handleToggleSound}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  soundEnabled
                    ? "border-[#4fa8d8]/20 bg-[#4fa8d8]/10 text-[#4fa8d8] hover:bg-[#4fa8d8]/20"
                    : "border-white/10 bg-black/20 text-muted-foreground hover:text-foreground/80"
                }`}
                aria-pressed={soundEnabled}
                title={soundEnabled ? "Sonido activado" : "Sonido desactivado"}
              >
                {soundEnabled ? (
                  <Volume2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" aria-hidden />
                )}
                {soundEnabled ? "Sonido on" : "Sonido off"}
              </button>
              {alerts.some((a) => a.triggered) && (
                <button
                  type="button"
                  onClick={onClearTriggered}
                  className="flex-1 rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  Limpiar disparadas
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
