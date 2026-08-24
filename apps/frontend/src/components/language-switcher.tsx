"use client";

import { useI18n } from "@/lib/i18n";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/locales";

/**
 * Compact language selector. Uses a native <select> so it works on every
 * device and needs no extra dropdown styling.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 10px",
        fontSize: 12,
        color: "var(--muted)",
      }}
    >
      {!compact && (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M2 8h12M8 2c1.8 1.6 2.8 3.8 2.8 6S9.8 12.4 8 14C6.2 12.4 5.2 10.2 5.2 8S6.2 3.6 8 2Z"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      )}
      <select
        aria-label="Language"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          border: "1px solid var(--line-soft)",
          background: "var(--bg)",
          color: "var(--fg)",
          borderRadius: 999,
          padding: "5px 26px 5px 12px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          backgroundImage:
            "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)",
          backgroundPosition:
            "calc(100% - 14px) 50%, calc(100% - 9px) 50%",
          backgroundSize: "4px 4px, 4px 4px",
          backgroundRepeat: "no-repeat",
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
