"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
} from "./locales";
import en, { type Messages } from "./messages/en";
import ru from "./messages/ru";
import zh from "./messages/zh";
import fr from "./messages/fr";
import de from "./messages/de";
import pt from "./messages/pt";
import it from "./messages/it";
import ja from "./messages/ja";
import ko from "./messages/ko";
import tr from "./messages/tr";
import pl from "./messages/pl";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const CATALOGS: Record<Locale, DeepPartial<Messages>> = {
  en,
  ru,
  zh,
  fr,
  de,
  pt,
  it,
  ja,
  ko,
  tr,
  pl,
};

const STORAGE_KEY = "postsider:locale";

/** Dot-path keys into the message catalog, e.g. "nav.calendar". */
type Join<K, P> = K extends string
  ? P extends string
    ? `${K}.${P}`
    : never
  : never;

type Paths<T> = {
  [K in keyof T]: T[K] extends Record<string, unknown>
    ? Join<K, Paths<T[K]>>
    : K;
}[keyof T];

export type MessageKey = Paths<Messages>;

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | null>(null);

function resolve(catalog: Messages, key: string): string | undefined {
  return key
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      catalog,
    ) as string | undefined;
}

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {}
  // Fall back to the browser language if we support it.
  const nav = window.navigator?.language?.slice(0, 2).toLowerCase();
  if (isLocale(nav)) return nav;
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Resolve the real locale on mount (client-only) to avoid hydration drift.
  useEffect(() => {
    setLocaleState(detectInitialLocale());
  }, []);

  // Keep <html lang> in sync for accessibility / SEO.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      const catalog = (CATALOGS[locale] ?? en) as Messages;
      const value = resolve(catalog, key) ?? resolve(en as Messages, key) ?? key;
      return interpolate(value, vars);
    },
    [locale],
  );

  const value = useMemo<I18nState>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within <I18nProvider>");
  }
  return ctx;
}

/** Convenience hook returning just the translate function. */
export function useT() {
  return useI18n().t;
}
