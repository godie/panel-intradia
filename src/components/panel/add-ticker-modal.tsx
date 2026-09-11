"use client";

import { useEffect, useState } from "react";
import { X, Plus, CheckCircle2, XCircle, Loader2, Sparkles } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

type Props = {
  open: boolean;
  /** Symbols already in the watchlist — used to surface "already added" warnings. */
  existing?: string[];
  onClose: () => void;
  onAdd: (symbol: string) => void;
};

const SUGGESTIONS = [
  "ADAUSDT",
  "DOTUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "DOGEUSDT",
  "TRXUSDT",
  "LTCUSDT",
  "ATOMUSDT",
  "NEARUSDT",
  "ARBUSDT",
];

type Status =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "valid" }
  | { kind: "invalid"; message: string };

/**
 * AddTickerModal — pick a Binance USDT pair to add to the watchlist.
 *
 * Flow: user types a symbol (or clicks a suggestion) → clicks "Validate" →
 * we call /api/analysis?symbol=X to confirm the pair exists on Binance. On
 * success, the parent's onAdd callback is invoked and the modal closes. On
 * failure we surface a localized error and let the user try again.
 *
 * i18n keys (under `ticker.*`): add, addDesc, symbol, placeholder, validate,
 * validating, valid, invalid, alreadyAdded, suggestions.
 */
export function AddTickerModal({ open, existing = [], onClose, onAdd }: Props) {
  const { t } = useLanguage();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Track previous `open` so we can reset state synchronously during render
  // when the modal opens. This is React's recommended "adjust state during
  // render" pattern (avoids the set-state-in-effect lint rule).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setInput("");
      setStatus({ kind: "idle" });
    }
  }

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const normalized = input.trim().toUpperCase();

  const validate = async (symbolArg?: string) => {
    const sym = (symbolArg ?? normalized).toUpperCase();
    if (!sym) {
      setStatus({ kind: "invalid", message: t("ticker.invalid") });
      return;
    }
    // Shape check — must end with USDT and be plausible length.
    if (!/^[A-Z]{2,12}USDT$/.test(sym) || sym.length < 6 || sym.length > 16) {
      setStatus({ kind: "invalid", message: t("ticker.invalid") });
      return;
    }
    if (existing.includes(sym)) {
      setStatus({ kind: "invalid", message: t("ticker.alreadyAdded") });
      return;
    }
    setStatus({ kind: "validating" });
    try {
      const res = await fetch(`/api/analysis?symbol=${sym}`, { cache: "no-store" });
      if (!res.ok) {
        setStatus({ kind: "invalid", message: t("ticker.invalid") });
        return;
      }
      const json = (await res.json()) as { symbol?: string } | { error?: string };
      if (json && "error" in json) {
        setStatus({ kind: "invalid", message: t("ticker.invalid") });
        return;
      }
      setStatus({ kind: "valid" });
      // Brief success flash, then propagate to parent.
      window.setTimeout(() => {
        onAdd(sym);
      }, 350);
    } catch {
      setStatus({ kind: "invalid", message: t("ticker.invalid") });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-card-enter"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("ticker.add")}
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-xl border border-white/10 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[#5fbf8f]/30 bg-[#5fbf8f]/10">
              <Plus className="h-4 w-4 text-[#5fbf8f]" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("ticker.add")}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {t("ticker.addDesc")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Input + validate */}
          <div className="space-y-2">
            <label
              htmlFor="add-ticker-input"
              className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t("ticker.symbol")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="add-ticker-input"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value.toUpperCase());
                  if (status.kind !== "idle") setStatus({ kind: "idle" });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    validate();
                  }
                }}
                placeholder={t("ticker.placeholder")}
                className="tnum flex h-9 w-full rounded-md border border-white/10 bg-black/30 px-3 py-1 text-sm uppercase tracking-wider text-foreground outline-none transition-colors focus-visible:border-[#4fa8d8] focus-visible:ring-2 focus-visible:ring-[#4fa8d8]/30"
                disabled={status.kind === "validating" || status.kind === "valid"}
              />
              <button
                type="button"
                onClick={() => validate()}
                disabled={
                  !normalized ||
                  status.kind === "validating" ||
                  status.kind === "valid"
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#4fa8d8]/30 bg-[#4fa8d8]/10 px-3 text-xs font-medium text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status.kind === "validating" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {t("ticker.validating")}
                  </>
                ) : status.kind === "valid" ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    {t("ticker.valid")}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    {t("ticker.validate")}
                  </>
                )}
              </button>
            </div>

            {/* Status row */}
            {status.kind === "invalid" && (
              <div className="flex items-center gap-2 rounded-md border border-[#e2604f]/30 bg-[#e2604f]/10 px-3 py-2 text-xs text-[#e2604f]">
                <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{status.message}</span>
              </div>
            )}
            {status.kind === "valid" && (
              <div className="flex items-center gap-2 rounded-md border border-[#5fbf8f]/30 bg-[#5fbf8f]/10 px-3 py-2 text-xs text-[#5fbf8f]">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{t("ticker.valid")}</span>
              </div>
            )}
          </div>

          {/* Suggestions */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("ticker.suggestions")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => {
                const already = existing.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      if (already) return;
                      setInput(s);
                      validate(s);
                    }}
                    disabled={already || status.kind === "validating" || status.kind === "valid"}
                    className={`tnum inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                      already
                        ? "border-white/5 bg-white/5 text-muted-foreground/40 line-through"
                        : "border-white/10 bg-black/20 text-foreground/80 hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    }`}
                    title={already ? t("ticker.alreadyAdded") : s}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
