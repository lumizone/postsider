"use client";

import { useT } from "@/lib/i18n";

interface PagePlaceholderProps {
  title: string;
  description: string;
}

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  const t = useT();
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <h1 style={{ fontSize: "32px", letterSpacing: "-0.03em" }}>{title}</h1>
        <p style={{ color: "var(--muted)", fontSize: "15px" }}>{description}</p>
      </header>

      <div
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--line-soft)",
          padding: "48px 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          textAlign: "center",
          minHeight: "320px",
        }}
      >
        <div
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "var(--radius-pill)",
            border: "1px solid var(--line-soft)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px",
          }}
          aria-hidden
        >
          ◯
        </div>
        <div style={{ fontSize: "16px", fontWeight: 600 }}>{t("placeholder.comingSoon")}</div>
        <div style={{ color: "var(--muted)", maxWidth: "420px" }}>
          {t("placeholder.underConstruction")}
        </div>
      </div>
    </section>
  );
}
