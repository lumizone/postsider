"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import s from "./agent-activity.module.css";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';

interface Props {
  /** Called with `true` only; the confirm button is disabled until the box is ticked. */
  onConfirm: (confirmed: boolean) => void;
  onCancel: () => void;
  busy: boolean;
}

/**
 * Confirmation for re-arming a destination whose outcome is unknown. Same
 * visual contract as ConfirmDialog (portal on <body>, scrim, Escape cancels)
 * plus a checkbox that starts unticked every time the dialog opens.
 */
export function RetryUnknownDialog({ onConfirm, onCancel, busy }: Props) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [checked, setChecked] = useState(false);
  const boxRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const opener = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!busyRef.current) cancelRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!panelRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (opener && opener.isConnected) opener.focus();
    };
  }, [mounted]);

  if (!mounted) return null;

  const confirm = () => {
    if (!checked || busy) return;
    onConfirm(true);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("agentActivity.retryUnknown.title")}
      className={s.modalScrim}
      onClick={(e) => {
        // The portal bubbles through the React tree: never let a click reach the drawer overlay.
        e.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <div ref={panelRef} className={s.modalPanel} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalText}>
          <h2 className={s.modalTitle}>{t("agentActivity.retryUnknown.title")}</h2>
          <p className={s.modalBody}>{t("agentActivity.retryUnknown.body")}</p>
        </div>
        <label className={s.modalCheck}>
          <input
            ref={boxRef}
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>{t("agentActivity.retryUnknown.check")}</span>
        </label>
        <div className={s.modalActions}>
          <button type="button" className={s.ghost} onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" className={s.primary} onClick={confirm} disabled={!checked || busy}>
            {busy ? t("common.working") : t("agentActivity.action.retryUnknown")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
