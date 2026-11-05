"use client";

import { useEffect, useState } from "react";
import { consentDecided, isPostsiderHost, writeConsent } from "@/lib/analytics-consent";
import { useT } from "@/lib/i18n";

/** Small bottom bar asking for analytics and marketing cookie consent. */
export function AnalyticsConsentBanner() {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const host = window.location.hostname;
    const eligible = isPostsiderHost() || host === "localhost";
    setVisible(eligible && !consentDecided());
  }, []);

  if (!visible) return null;

  const choose = (granted: boolean) => {
    writeConsent(granted);
    setVisible(false);
  };

  const button = {
    font: "inherit",
    fontSize: 13,
    fontWeight: 600,
    padding: "6px 14px",
    borderRadius: 8,
    border: "1px solid var(--line)",
    cursor: "pointer",
  } as const;

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 1000,
        maxWidth: 720,
        margin: "0 auto",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        background: "var(--bg)",
        color: "var(--fg)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgb(var(--shadow) / 0.12)",
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <p style={{ margin: 0, flex: "1 1 280px" }}>
        {t("analyticsConsent.text")}{" "}
        <a
          href="https://postsider.com/privacy/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "inherit", textDecoration: "underline" }}
        >
          {t("analyticsConsent.privacy")}
        </a>
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => choose(false)}
          style={{ ...button, background: "var(--bg)", color: "var(--fg)" }}
        >
          {t("analyticsConsent.reject")}
        </button>
        <button
          type="button"
          onClick={() => choose(true)}
          style={{ ...button, background: "var(--fg)", color: "var(--on-fg)" }}
        >
          {t("analyticsConsent.accept")}
        </button>
      </div>
    </div>
  );
}
