"use client";

import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import { translate, type Lang, LANGUAGES } from "@/lib/i18n";
import { useLocalStorageString } from "@/hooks/use-local-storage";

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
 * Hydration safety: the language is stored via `useSyncExternalStore`
 * (useLocalStorageString). SSR and the hydration render always see the
 * default "es", so server and client markup match (React error #418); the
 * persisted choice is picked up right after hydration without any
 * setState-in-effect.
 *
 * Usage in a component:
 *   const { t, lang } = useLanguage();
 *   <h1>{t("header.title")}</h1>
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [storedLang, setStoredLang] = useLocalStorageString(STORAGE_KEY, "es");

  // Validate the stored value — invalid/corrupt entries fall back to "es".
  const lang = useMemo<Lang>(
    () => (LANGUAGES.some((l) => l.code === storedLang) ? (storedLang as Lang) : "es"),
    [storedLang],
  );

  const setLang = useCallback(
    (newLang: Lang) => setStoredLang(newLang),
    [setStoredLang],
  );

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
