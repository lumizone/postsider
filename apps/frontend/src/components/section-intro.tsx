"use client";

import { useEffect, useState } from "react";
import styles from "./section-intro.module.css";
import { useT, type MessageKey } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";

/**
 * A one-time, dismissible explanation of what a section is for.
 *
 * Deliberately NOT a linear product tour: measured tour completion is poor
 * (most users abandon by the third step) while contextual guidance shown at
 * the point of use performs far better, because it arrives when the user is
 * already looking at the thing. So each section explains itself once, in
 * place, and never blocks anything.
 *
 * Seen-state is per user and per section in localStorage. It is a display
 * preference, not business state, so it does not warrant a column; the cost
 * of losing it is that someone sees one short card again.
 */
export function SectionIntro({
  id,
  titleKey,
  bodyKey,
}: {
  /** Stable key for this section, e.g. "calendar". Changing it re-shows. */
  id: string;
  titleKey: MessageKey;
  bodyKey: MessageKey;
}) {
  const t = useT();
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  const storageKey = `postsider:section-intro:${user?.id ?? "anon"}:${id}`;

  // Read after mount: localStorage is unavailable during SSR, and seeding
  // useState from it would desync the first client render.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setVisible(window.localStorage.getItem(storageKey) !== "1");
  }, [storageKey]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, "1");
    }
  };

  return (
    <aside className={styles.card} role="note">
      <div className={styles.text}>
        <p className={styles.title}>{t(titleKey)}</p>
        <p className={styles.body}>{t(bodyKey)}</p>
      </div>
      <button
        type="button"
        className={styles.dismiss}
        onClick={dismiss}
        aria-label={t("sectionIntro.dismiss")}
      >
        {t("sectionIntro.gotIt")}
      </button>
    </aside>
  );
}
