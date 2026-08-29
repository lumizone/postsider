"use client";

import type { ReactNode } from "react";
import styles from "./settings-ui.module.css";

export const settingsStyles = styles;

export function PageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className={styles.pageHead}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1 className={styles.h1}>{title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.cardTitle}>{title}</div>
          {subtitle && <div className={styles.cardSub}>{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

interface SwitchProps {
  on: boolean;
  onChange: () => void;
  label?: string;
}

export function Switch({ on, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={styles.switch + (on ? " " + styles.switchOn : "")}
      onClick={onChange}
    >
      <span className={styles.switchKnob} aria-hidden />
    </button>
  );
}

interface ToggleRowProps {
  title: string;
  description: string;
  on: boolean;
  onChange: () => void;
}

export function ToggleRow({ title, description, on, onChange }: ToggleRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={styles.rowSub}>{description}</span>
      </div>
      <Switch on={on} onChange={onChange} label={title} />
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const initials =
    parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  return (
    <span className={styles.avatar} aria-hidden>
      {initials}
    </span>
  );
}

export function StatusChip({
  variant,
  children,
}: {
  variant?: "filled" | "muted" | "default";
  children: ReactNode;
}) {
  const v = variant ?? "default";
  const cls =
    styles.chip +
    (v === "filled" ? " " + styles.chipFilled : "") +
    (v === "muted" ? " " + styles.chipMuted : "");
  return (
    <span className={cls}>
      <span className={styles.chipDot} aria-hidden />
      {children}
    </span>
  );
}
