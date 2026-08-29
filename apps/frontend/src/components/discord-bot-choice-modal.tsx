"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n";

interface DiscordBotChoiceModalProps {
  onChooseShared: () => void;
  onChooseOwn: () => void;
  onCancel: () => void;
}

/**
 * Discord is the only provider offering two connect paths for the same
 * action: PostSider's shared bot (zero setup, but every post shows the
 * shared bot's own name/avatar — Discord's Bot API has no per-message
 * identity override) or the org's own bot (posts show up under their bot's
 * own identity instead, at the cost of creating a Discord bot application
 * themselves and pasting its token).
 */
export function DiscordBotChoiceModal({
  onChooseShared,
  onChooseOwn,
  onCancel,
}: DiscordBotChoiceModalProps) {
  const t = useT();
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("discordChoice.title")}
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          borderRadius: "var(--radius-lg)",
          background: "var(--bg)",
          border: "1px solid var(--line-soft)",
          padding: 24,
        }}
      >
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>
          {t("discordChoice.title")}
        </h2>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 18px", lineHeight: 1.5 }}>
          {t("discordChoice.subtitle")}
        </p>

        <button
          ref={firstRef}
          type="button"
          onClick={onChooseShared}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "12px 14px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--line-soft)",
            background: "var(--bg)",
            color: "var(--fg)",
            cursor: "pointer",
            marginBottom: 8,
          }}
        >
          <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>
            {t("discordChoice.sharedTitle")}
          </span>
          <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {t("discordChoice.sharedDesc")}
          </span>
        </button>

        <button
          type="button"
          onClick={onChooseOwn}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "12px 14px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--line-soft)",
            background: "var(--bg)",
            color: "var(--fg)",
            cursor: "pointer",
          }}
        >
          <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>
            {t("discordChoice.ownTitle")}
          </span>
          <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {t("discordChoice.ownDesc")}
          </span>
        </button>

        <button
          type="button"
          onClick={onCancel}
          style={{
            display: "block",
            width: "100%",
            marginTop: 14,
            padding: "8px 0",
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
