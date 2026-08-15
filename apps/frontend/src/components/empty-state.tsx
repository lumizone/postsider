"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  /** Click handler used instead of a link when provided. */
  onAction?: () => void;
  icon?: "calendar" | "posts" | "media" | "analytics" | "channel";
}

const icons: Record<string, ReactNode> = {
  calendar: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="8" y="12" width="32" height="28" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <path d="M8 20h32" stroke="currentColor" strokeWidth="2.5" />
      <path d="M16 8v6M32 8v6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="24" cy="30" r="3" fill="currentColor" opacity="0.3" />
    </svg>
  ),
  posts: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="8" y="8" width="32" height="32" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <path d="M16 18h16M16 24h16M16 30h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  media: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="8" y="12" width="32" height="24" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="18" cy="22" r="3" fill="currentColor" opacity="0.3" />
      <path d="M10 32l10-8 8 8 5-4 5 4" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  ),
  analytics: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <path d="M12 36V24M20 36V16M28 36V28M36 36V20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M8 40h32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  channel: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="2.5" />
      <path d="M24 16v16M16 24h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
};

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  icon = "channel",
}: EmptyStateProps) {
  // "posts" empty state uses the PostSider avatar (symbolizes empty space).
  // Other states keep the brand illustration (connect/setup oriented).
  const imageSrc =
    icon === "posts" ? "/postsider-avatar.png" : "/brand/empty-state.png";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 24px",
        textAlign: "center",
        color: "var(--muted)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt=""
        width={180}
        height={180}
        style={{ width: 180, height: 180, objectFit: "contain", marginBottom: 20, opacity: 0.9 }}
      />
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 18,
          fontWeight: 600,
          color: "var(--fg)",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: "0 0 20px",
          fontSize: 14,
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            display: "inline-block",
            padding: "10px 20px",
            background: "var(--fg)",
            color: "var(--bg)",
            border: "none",
            borderRadius: "var(--radius-md)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      )}
      {actionLabel && actionHref && !onAction && (
        <Link
          href={actionHref}
          style={{
            display: "inline-block",
            padding: "10px 20px",
            background: "var(--fg)",
            color: "var(--bg)",
            borderRadius: "var(--radius-md)",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
