"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./info-tip.module.css";
import { useT, type MessageKey } from "@/lib/i18n";

/**
 * A "?" affordance that explains one piece of product vocabulary in place.
 *
 * Exists because a first-run tester could not define channel, queue, slot,
 * evergreen, first comment, snippet, or global-vs-per-channel, and none of
 * them were explained anywhere in the app outside a FAQ on the billing page.
 * Jargon does not need a tour; it needs a definition next to the word.
 *
 * Click (not hover) to open, so it works on touch — hover-only help is
 * invisible on a phone. Escape and outside-click close it.
 */
export function InfoTip({ textKey }: { textKey: MessageKey }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <span className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-label={t("infoTip.whatIsThis")}
        aria-expanded={open}
        aria-controls={id}
      >
        ?
      </button>
      {open && (
        <span className={styles.bubble} id={id} role="tooltip">
          {t(textKey)}
        </span>
      )}
    </span>
  );
}
