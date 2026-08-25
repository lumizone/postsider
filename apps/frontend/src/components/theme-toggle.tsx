"use client";

import { useTheme } from "@/lib/theme";
import { useT } from "@/lib/i18n";

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1v1.8M8 13.2V15M15 8h-1.8M2.8 8H1M12.95 3.05l-1.27 1.27M4.32 11.68l-1.27 1.27M12.95 12.95l-1.27-1.27M4.32 4.32L3.05 3.05"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M13.4 9.9A5.7 5.7 0 0 1 6.1 2.6a5.9 5.9 0 1 0 7.3 7.3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Light ⇄ dark switch for the sidebar footer and the mobile topbar.
 *
 * Deliberately two-state: it flips whatever is currently on screen, so a
 * "system" user who wants to override just taps it. The three-way choice
 * (including "follow the system") lives in Settings → General, where there is
 * room to name the options.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, preference, toggle } = useTheme();
  const t = useT();
  const dark = theme === "dark";

  const label = dark ? t("theme.switchToLight") : t("theme.switchToDark");

  return (
    <button
      type="button"
      onClick={toggle}
      title={preference === "system" ? t("theme.followingSystem") : label}
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        alignSelf: "flex-start",
        margin: compact ? 0 : "0 10px",
        padding: compact ? 6 : "5px 12px",
        minHeight: 32,
        border: "1px solid var(--line-soft)",
        borderRadius: 999,
        background: "var(--bg)",
        color: "var(--muted)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {dark ? <MoonIcon /> : <SunIcon />}
      {!compact && <span>{dark ? t("theme.dark") : t("theme.light")}</span>}
    </button>
  );
}
