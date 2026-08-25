"use client";

import type { ReactNode } from "react";
import styles from "./auth.module.css";
import { useT } from "@/lib/i18n";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  banner,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  banner?: ReactNode;
}) {
  const t = useT();
  return (
    <div className={styles.page}>
      {banner && <div className={styles.topBanner}>{banner}</div>}
      <div className={styles.card}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/postsider-logo.png"
            alt=""
            width={36}
            height={36}
            aria-hidden
            className={`${styles.brandLogo} brand-mark`}
          />
          <span className={styles.brandName}>PostSider</span>
        </div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
        {children}
        {footer && <div className={styles.foot}>{footer}</div>}
        <div className={styles.legal}>
          {t("auth.legalPrefix")}{" "}
          <a
            href="https://postsider.com/terms"
            target="_blank"
            rel="noreferrer"
          >
            {t("auth.legalTerms")}
          </a>{" "}
          {t("auth.legalAnd")}{" "}
          <a
            href="https://postsider.com/privacy"
            target="_blank"
            rel="noreferrer"
          >
            {t("auth.legalPrivacy")}
          </a>
          .
        </div>
      </div>
    </div>
  );
}
