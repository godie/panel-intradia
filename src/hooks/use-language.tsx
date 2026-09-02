"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { translate, type Lang, LANGUAGES } from "@/lib/i18n";

type LanguageContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "panel:lang";

/**
 * LanguageProvider — wraps the app and provides the current language + a `t()`
 * function for translating keys. The selected language is persisted in
 * localStorage and defaults to "es" (Spanish — the original dashboard language).
 *
 * Usage in a component:
 *   const { t, lang } = useLanguage();
 *   <h1>{t("header.title")}</h1>
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "es";
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (stored && LANGUAGES.some((l) => l.code === stored)) return stored;
    } catch {
      // ignore
    }
    return "es";
  });

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: string) => translate(lang, key),
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * useLanguage — hook to access the current language and translation function.
 * Must be used inside a LanguageProvider.
 */
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
