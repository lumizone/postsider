"use client";

import type { ReactNode } from "react";
import styles from "./auth.module.css";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/postsider-logo.png"
            alt=""
            width={36}
            height={36}
            aria-hidden
            className={styles.brandLogo}
          />
          <span className={styles.brandName}>PostSider</span>
        </div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
        {children}
        {footer && <div className={styles.foot}>{footer}</div>}
      </div>
    </div>
  );
}
