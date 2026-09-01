"use client";

import { useState, useRef, useEffect } from "react";
import { Globe, Check } from "lucide-react";
import { LANGUAGES, type Lang } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";

/**
 * LanguageSelector — a dropdown button in the header that lets the user
 * switch between the 4 supported languages (ES, EN, ZH, FR).
 *
 * The selected language is persisted in localStorage via the LanguageProvider.
 * Uses a click-outside-to-close pattern.
 */
export function LanguageSelector() {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        aria-label="Select language"
        aria-expanded={open}
      >
        <Globe className="h-3.5 w-3.5" aria-hidden />
        <span className="text-sm">{current.flag}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-card shadow-xl">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                setLang(l.code as Lang);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                l.code === lang
                  ? "bg-[#4fa8d8]/10 text-[#4fa8d8]"
                  : "text-foreground/70 hover:bg-white/5 hover:text-foreground"
              }`}
            >
              <span className="text-sm">{l.flag}</span>
              <span className="flex-1">{l.label}</span>
              {l.code === lang && <Check className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
