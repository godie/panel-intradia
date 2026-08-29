"use client";

import { useEffect } from "react";

type Handlers = {
  onRefresh?: () => void;
  onCollapseAll?: () => void;
  onExpandAll?: () => void;
  onToggleHelp?: () => void;
};

/**
 * useKeyboardShortcuts — global keyboard handler for the dashboard.
 *
 * Shortcuts:
 *  - R / r — trigger a manual refresh (calls onRefresh)
 *  - C / c — collapse all collapsible sections (broadcasts a CustomEvent
 *    "panel:collapse-all" that CollapsibleSection listens for)
 *  - E / e — expand all collapsible sections (broadcasts "panel:expand-all")
 *  - ? — toggle the keyboard shortcuts help modal (calls onToggleHelp)
 *  - Escape — handled per-component (modals close on Escape)
 *
 * Ignores keystrokes when the user is typing in an input, textarea, or
 * contenteditable element (so the dashboard doesn't refresh while the user
 * is searching, etc.).
 */
export function useKeyboardShortcuts(handlers: Handlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't fire when typing in form fields.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      // Don't fire on modifier combos (Ctrl+R, Cmd+R, etc.).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      switch (key) {
        case "r":
          handlers.onRefresh?.();
          break;
        case "c":
          window.dispatchEvent(new CustomEvent("panel:collapse-all"));
          break;
        case "e":
          window.dispatchEvent(new CustomEvent("panel:expand-all"));
          break;
        case "?":
          // Shift+/ produces "?" — but we also catch the "/" key with shift.
          handlers.onToggleHelp?.();
          break;
        case "/":
          if (e.shiftKey) handlers.onToggleHelp?.();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
