"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { AppNotification } from "@/lib/notifications-api";

export type NotificationSeverity = "error" | "warning" | "success" | "info";

interface EventMeta {
  /** Translated message shown instead of the stored English `content`. */
  message: MessageKey;
  severity: NotificationSeverity;
}

/**
 * Event key -> how to render it.
 *
 * Notifications are produced server-side in English (the email needs a
 * rendered string), so the dashboard re-renders the known ones from this map
 * in the customer's own language. Anything not listed - older rows, or an
 * event added later - falls back to the stored English text and `info`
 * severity, which is why `content` is still written for every notification.
 *
 * Severity is derived here rather than stored: `NotificationType` exists on
 * the producer side but only ever reached the email layer, and the 102 rows
 * that predate this UI have no type at all. Listed explicitly rather than
 * built from the key so the message ids stay compile-checked.
 */
export const NOTIFICATION_EVENTS: Record<string, EventMeta> = {
  channelReconnect: {
    message: "notifications.events.channelReconnect",
    severity: "warning",
  },
  postFailedReconnect: {
    message: "notifications.events.postFailedReconnect",
    severity: "error",
  },
  postFailedDisabled: {
    message: "notifications.events.postFailedDisabled",
    severity: "error",
  },
  postPublished: {
    message: "notifications.events.postPublished",
    severity: "success",
  },
  approvalRequested: {
    message: "notifications.events.approvalRequested",
    severity: "info",
  },
  approvalApproved: {
    message: "notifications.events.approvalApproved",
    severity: "success",
  },
  approvalRejected: {
    message: "notifications.events.approvalRejected",
    severity: "warning",
  },
  approvalRejectedNote: {
    message: "notifications.events.approvalRejectedNote",
    severity: "warning",
  },
  publishingPaused: {
    message: "notifications.events.publishingPaused",
    severity: "warning",
  },
  publishingResumed: {
    message: "notifications.events.publishingResumed",
    severity: "info",
  },
};

export function severityOf(n: AppNotification): NotificationSeverity {
  return (n.eventKey && NOTIFICATION_EVENTS[n.eventKey]?.severity) || "info";
}

interface ResolvedLink {
  href: string;
  /** Off-site destination (a published post on the platform), opened in a new tab. */
  external: boolean;
}

/**
 * Links are stored absolute (the backend builds them from FRONTEND_URL, since
 * the same text is reused in the email), but they are not all ours: a
 * "published" notification links to the post ON THE PLATFORM. So same-origin
 * links become in-app navigations, http(s) links elsewhere open in a new tab,
 * and anything else (javascript:, data:) is dropped rather than rendered.
 *
 * The previous version rewrote every off-site link to /calendar, which is why
 * a successful publish offered a "Fix it" button that dumped the reader on the
 * calendar instead of showing them their post.
 */
export function resolveLink(link?: string | null): ResolvedLink | null {
  if (!link) return null;
  const origin =
    typeof window === "undefined" ? "https://localhost" : window.location.origin;
  try {
    const url = new URL(link, origin);
    if (url.origin === origin) {
      return { href: url.pathname + url.search, external: false };
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { href: url.href, external: true };
    }
    return null;
  } catch {
    return link.startsWith("/") ? { href: link, external: false } : null;
  }
}

/** Renders a notification in the reader's language, with English as fallback. */
export function useNotificationText() {
  const { t } = useI18n();
  return useCallback(
    (n: AppNotification) => {
      const meta = n.eventKey ? NOTIFICATION_EVENTS[n.eventKey] : undefined;
      if (!meta) return n.content;
      let params: Record<string, string> = {};
      if (n.eventParams) {
        try {
          params = JSON.parse(n.eventParams) ?? {};
        } catch {
          // Malformed params must not blank the notification - show the
          // English text rather than a message full of empty placeholders.
          return n.content;
        }
      }
      return t(meta.message, params);
    },
    [t]
  );
}

/** "3 minutes ago" in the reader's locale, with the full timestamp on hover. */
export function useRelativeTime() {
  const { t, locale } = useI18n();
  return useCallback(
    (iso: string) => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return { label: "", title: "" };
      const title = date.toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const seconds = Math.round((Date.now() - date.getTime()) / 1000);
      if (seconds < 60) return { label: t("notifications.justNow"), title };

      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return { label: rtf.format(-minutes, "minute"), title };
      const hours = Math.round(minutes / 60);
      if (hours < 24) return { label: rtf.format(-hours, "hour"), title };
      const days = Math.round(hours / 24);
      if (days < 7) return { label: rtf.format(-days, "day"), title };
      return {
        label: date.toLocaleDateString(locale, {
          month: "short",
          day: "numeric",
          year:
            date.getFullYear() === new Date().getFullYear()
              ? undefined
              : "numeric",
        }),
        title,
      };
    },
    [t, locale]
  );
}

const ACCENT: Record<NotificationSeverity, string> = {
  // The product is deliberately black and white, so color is spent only where
  // it carries meaning: something is broken and publishing has stopped.
  error: "var(--danger-bright)",
  warning: "var(--warning)",
  success: "var(--fg)",
  info: "var(--muted)",
};

function SeverityIcon({ severity }: { severity: NotificationSeverity }) {
  const color = ACCENT[severity];
  if (severity === "error" || severity === "warning") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8 2.6 14.4 13.4H1.6L8 2.6Z"
          stroke={color}
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M8 6.6v3" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r="0.75" fill={color} />
      </svg>
    );
  }
  if (severity === "success") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6.2" stroke={color} strokeWidth="1.3" />
        <path
          d="m5.4 8.2 1.8 1.8 3.4-3.8"
          stroke={color}
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.2" stroke={color} strokeWidth="1.3" />
      <path d="M8 7.2v3.4" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.2" r="0.75" fill={color} />
    </svg>
  );
}

export interface NotificationRowProps {
  notification: AppNotification;
  /** Arrived after this reader's last visit to the list. */
  unread?: boolean;
  /** Called when an in-app link is followed (the bell closes its panel). */
  onNavigate?: () => void;
  compact?: boolean;
}

export function NotificationRow({
  notification,
  unread = false,
  onNavigate,
  compact = false,
}: NotificationRowProps) {
  const { t } = useI18n();
  const text = useNotificationText();
  const relative = useRelativeTime();

  const severity = severityOf(notification);
  const link = resolveLink(notification.link);
  const when = relative(notification.createdAt);

  // A successful publish gets "View post", not "Fix it" - the label has to
  // match what the link actually does, or the whole panel reads like an alarm.
  const actionLabel: MessageKey =
    severity === "error" || severity === "warning"
      ? "notifications.action"
      : link?.external
      ? "notifications.actionView"
      : "notifications.actionOpen";

  const actionStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: compact ? "5px 10px" : "7px 12px",
    // A thumb has to be able to hit this: it is the only action the
    // notification offers.
    minHeight: compact ? 30 : 34,
    border: "1px solid var(--line-soft)",
    borderRadius: "var(--radius-pill)",
    background: "var(--bg)",
    color: "var(--fg)",
    fontSize: compact ? 11 : 12,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  return (
    <li
      style={{
        display: "flex",
        gap: 10,
        padding: compact ? "10px 12px" : "14px 16px",
        borderRadius: "var(--radius-sm)",
        background: unread ? "var(--hover)" : "transparent",
      }}
    >
      <span style={{ flexShrink: 0, lineHeight: 0, marginTop: 1 }}>
        <SeverityIcon severity={severity} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: compact ? 13 : 14,
            lineHeight: 1.4,
            wordBreak: "break-word",
            fontWeight: unread ? 600 : 400,
          }}
        >
          {text(notification)}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            fontSize: compact ? 11 : 12,
            color: "var(--muted)",
          }}
        >
          <time dateTime={notification.createdAt} title={when.title}>
            {when.label}
          </time>
          {link &&
            (link.external ? (
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                style={actionStyle}
              >
                {t(actionLabel)}
              </a>
            ) : (
              <Link href={link.href} onClick={onNavigate} style={actionStyle}>
                {t(actionLabel)}
              </Link>
            ))}
        </span>
      </div>
      {unread && (
        <span
          aria-label={t("notifications.newBadge")}
          style={{
            flexShrink: 0,
            width: 7,
            height: 7,
            marginTop: 6,
            borderRadius: "50%",
            background: "var(--fg)",
          }}
        />
      )}
    </li>
  );
}

interface DayGroup {
  key: string;
  items: AppNotification[];
}

/** Local-day buckets, newest first, preserving the server's ordering. */
export function groupByDay(items: AppNotification[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = Number.isNaN(date.getTime())
      ? "unknown"
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

export interface NotificationGroupsProps {
  items: AppNotification[];
  /** Read mark from before this fetch: anything newer is flagged as new. */
  lastReadAt?: string | null;
  onNavigate?: () => void;
  compact?: boolean;
}

/** The grouped, day-headed list shared by the bell panel and the full page. */
export function NotificationGroups({
  items,
  lastReadAt,
  onNavigate,
  compact = false,
}: NotificationGroupsProps) {
  const { t, locale } = useI18n();
  const groups = useMemo(() => groupByDay(items), [items]);
  const readAt = lastReadAt ? new Date(lastReadAt).getTime() : null;

  const headerFor = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round(
      (startOfDay(new Date()) - startOfDay(date)) / 86_400_000
    );
    if (diffDays === 0) return t("notifications.today");
    if (diffDays === 1) return t("notifications.yesterday");
    return date.toLocaleDateString(locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 10 }}>
      {groups.map((group) => (
        <section key={group.key}>
          <h3
            style={{
              margin: 0,
              padding: compact ? "8px 12px 4px" : "10px 16px 6px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {headerFor(group.items[0].createdAt)}
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {group.items.map((n, i) => (
              <NotificationRow
                key={n.id ?? `${n.createdAt}-${i}`}
                notification={n}
                unread={
                  readAt !== null && new Date(n.createdAt).getTime() > readAt
                }
                onNavigate={onNavigate}
                compact={compact}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
