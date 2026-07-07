"use client";

import { useEffect } from "react";
import styles from "./channel-detail-modal.module.css";
import { ChannelAvatar } from "./channel-avatar";
import {
  CHANNEL_COLOR_PALETTE,
  type Channel,
} from "@/lib/calendar-data";
import { useT } from "@/lib/i18n";

interface ChannelDetailModalProps {
  channel: Channel;
  onClose: () => void;
  onColorChange: (color: string) => void;
  onReconnect: () => void;
  onDelete: () => void;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="13" height="13">
      <rect
        x="5"
        y="5"
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M3.5 10.5V4.25C3.5 3.56 4.06 3 4.75 3H10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChannelDetailModal({
  channel,
  onClose,
  onColorChange,
  onReconnect,
  onDelete,
}: ChannelDetailModalProps) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const copyId = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(channel.id).catch(() => {});
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`${channel.name} channel`}
      onClick={onClose}
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.identity}>
            <ChannelAvatar channel={channel} size={44} radius={12} />
            <div className={styles.identityText}>
              <span className={styles.name}>{channel.name}</span>
              <span className={styles.platform}>{channel.platform}</span>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <CloseIcon />
          </button>
        </header>

        <dl className={styles.meta}>
          <div className={styles.metaRow}>
            <dt className={styles.metaLabel}>Channel ID</dt>
            <dd className={styles.metaValue}>
              <code className={styles.code}>{channel.id}</code>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={copyId}
                aria-label="Copy channel ID"
                title="Copy channel ID"
              >
                <CopyIcon />
              </button>
            </dd>
          </div>
          <div className={styles.metaRow}>
            <dt className={styles.metaLabel}>Platform</dt>
            <dd className={styles.metaValue}>{channel.platform}</dd>
          </div>
          <div className={styles.metaRow}>
            <dt className={styles.metaLabel}>Audience</dt>
            <dd className={styles.metaValue}>
              {channel.audience.toLocaleString()}
            </dd>
          </div>
        </dl>

        <section className={styles.section}>
          <span className={styles.sectionLabel}>Calendar color</span>
          <div className={styles.swatches} role="radiogroup" aria-label="Calendar color">
            {CHANNEL_COLOR_PALETTE.map((c) => {
              const active = c.value.toLowerCase() === channel.color.toLowerCase();
              return (
                <button
                  type="button"
                  key={c.value}
                  role="radio"
                  aria-checked={active}
                  className={styles.swatch + (active ? " " + styles.swatchActive : "")}
                  style={{ background: c.value }}
                  onClick={() => onColorChange(c.value)}
                  title={c.label}
                  aria-label={c.label}
                >
                  {active && (
                    <span className={styles.swatchCheck} aria-hidden>
                      <CheckIcon />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <footer className={styles.actions}>
          <button
            type="button"
            className={styles.btnDanger}
            onClick={onDelete}
          >
            {t("channels.delete")}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={onReconnect}
          >
            {t("channels.reconnect")}
          </button>
        </footer>
      </div>
    </div>
  );
}
