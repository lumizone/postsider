/**
 * Supported UI languages. English is the source/base locale and the fallback
 * for any missing keys.
 */
export const LOCALES = [
  "en",
  "ru",
  "zh",
  "fr",
  "de",
  "pt",
  "it",
  "ja",
  "ko",
  "tr",
  "pl",
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Native display names for the language switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  zh: "中文",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  it: "Italiano",
  ja: "日本語",
  ko: "한국어",
  tr: "Türkçe",
  pl: "Polski",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
