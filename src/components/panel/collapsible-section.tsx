"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  /** Title label shown on the trigger button. */
  label: string;
  /** Optional badge count or indicator shown next to the label. */
  badge?: ReactNode;
  /** Content to render inside the collapsible. */
  children: ReactNode;
  /** Whether the section starts expanded. Default: true (expanded on desktop). */
  defaultOpen?: boolean;
  /** Accent color for the chevron + label. */
  accent?: string;
};

/**
 * CollapsibleSection — a compact section wrapper with a header button that
 * toggles content visibility. Used to compact the AssetCard on mobile (MACD,
 * Order Book, metrics) while staying expanded on desktop by default.
 *
 * The trigger is a full-width button with a chevron that rotates 180° when
 * open. Keyboard accessible (native button, focus-visible ring).
 *
 * Listens for global "panel:collapse-all" and "panel:expand-all" CustomEvents
 * (dispatched by the useKeyboardShortcuts hook on C / E keypress) so the user
 * can collapse/expand ALL sections across ALL cards at once.
 */
export function CollapsibleSection({
  label,
  badge,
  children,
  defaultOpen = true,
  accent = "#8b96a5",
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const onCollapse = () => setOpen(false);
    const onExpand = () => setOpen(true);
    window.addEventListener("panel:collapse-all", onCollapse);
    window.addEventListener("panel:expand-all", onExpand);
    return () => {
      window.removeEventListener("panel:collapse-all", onCollapse);
      window.removeEventListener("panel:expand-all", onExpand);
    };
  }, []);

  return (
    <div className="px-5 pb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-md border border-white/5 bg-black/15 px-2.5 py-1.5 text-left transition-colors hover:bg-black/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: accent }}
          >
            {label}
          </span>
          {badge}
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}
