"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red styling for destructive actions. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared confirmation modal used across the app for destructive or
 * irreversible actions. Keeps focus inside the dialog and closes on Escape.
 *
 * Rendered through a portal on <body>. Its own z-index is not enough: the
 * dashboard sidebar is `position: sticky`, and a sticky element ALWAYS opens a
 * stacking context — even at `z-index: auto` — so a dialog rendered inside it
 * had its z-index scoped to the sidebar. <main> comes later in the document at
 * the same level, so the calendar painted straight over the dialog and its
 * buttons could not be clicked at all (the notification "Clear" confirmation
 * was dead in every theme). The notifications panel was moved to a portal for
 * exactly this reason; this is the same fix for every confirmation in the app.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  // A portal needs a DOM target, so the first render produces nothing and the
  // real tree lands on the second. `mounted` is therefore a dependency of the
  // focus effect below — without it that effect would run against a tree that
  // does not exist yet and the confirm button would never take focus.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mounted, onCancel, busy]);

  const accent = danger ? "var(--danger-bright)" : "var(--fg)";

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => !busy && onCancel()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        background: "var(--scrim)",
        backdropFilter: "blur(4px)",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--bg)",
          borderRadius: 16,
          padding: "26px 24px 22px",
          boxShadow: "0 24px 64px rgb(var(--shadow) / calc(0.18 * var(--shadow-boost)))",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: accent }}>
            {title}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
            {body}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid var(--line-soft)",
              background: "var(--bg)",
              fontSize: 14,
              fontWeight: 500,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              background: accent,
              color: "var(--on-fg)",
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? t("common.working") : (confirmLabel ?? t("common.confirm"))}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
