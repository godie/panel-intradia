"use client";

import { useEffect } from "react";
import { X, Keyboard, RefreshCw, ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
};

const SHORTCUTS = [
  {
    key: "R",
    desc: "Refrescar todos los datos del panel",
    icon: RefreshCw,
    color: "#4fa8d8",
  },
  {
    key: "C",
    desc: "Colapsar todas las secciones colapsables",
    icon: ChevronDown,
    color: "#e8b04b",
  },
  {
    key: "E",
    desc: "Expandir todas las secciones colapsables",
    icon: ChevronUp,
    color: "#5fbf8f",
  },
  {
    key: "?",
    desc: "Mostrar esta ayuda de atajos",
    icon: HelpCircle,
    color: "#b48cff",
  },
  {
    key: "Esc",
    desc: "Cerrar modales y overlays",
    icon: X,
    color: "#8b96a5",
  },
];

/**
 * KeyboardHelpModal — a modal listing all available keyboard shortcuts.
 * Opened by pressing "?" (Shift+/) or clicking the hint in the header.
 * Closes on Escape or clicking outside.
 */
export function KeyboardHelpModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-card-enter"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Atajos de teclado"
    >
      <div
        className="relative w-full max-w-sm mx-4 rounded-xl border border-white/10 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 p-4">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-[#4fa8d8]" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">
              Atajos de teclado
            </h3>
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

        {/* Shortcuts list */}
        <div className="p-4">
          <ul className="space-y-2">
            {SHORTCUTS.map((s) => {
              const Icon = s.icon;
              return (
                <li
                  key={s.key}
                  className="flex items-center gap-3 rounded-lg border border-white/5 bg-black/15 px-3 py-2"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
                    style={{
                      borderColor: `${s.color}40`,
                      background: `${s.color}12`,
                    }}
                  >
                    <Icon
                      className="h-4 w-4"
                      style={{ color: s.color }}
                      aria-hidden
                    />
                  </div>
                  <span className="flex-1 text-xs text-foreground/80">
                    {s.desc}
                  </span>
                  <kbd
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-white/15 bg-black/30 px-1.5 tnum text-[10px] font-semibold text-foreground/90"
                    style={{ color: s.color }}
                  >
                    {s.key}
                  </kbd>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-center text-[10px] text-muted-foreground/50">
            Los atajos se ignoran cuando escribes en campos de formulario.
          </p>
        </div>
      </div>
    </div>
  );
}
