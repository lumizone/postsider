"use client";

import Link from "next/link";
import styles from "./not-found.module.css";
import { useT } from "@/lib/i18n";

/**
 * Branded 404. Next's default not-found page renders outside the design
 * system entirely (bare Times/Arial, no brand), which stood out once every
 * other public screen was aligned.
 */
export default function NotFound() {
  const t = useT();
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/postsider-logo.png"
          alt=""
          width={36}
          height={36}
          aria-hidden
          className={styles.logo}
        />
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>{t("notFound.title")}</h1>
        <p className={styles.subtitle}>{t("notFound.subtitle")}</p>
        <div className={styles.actions}>
          <Link href="/calendar" className={styles.primary}>
            {t("notFound.backToCalendar")}
          </Link>
          <Link href="/login" className={styles.secondary}>
            {t("notFound.signIn")}
          </Link>
        </div>
      </div>
    </main>
  );
}
