"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  clearNotifications,
  getNotificationCount,
  getNotificationList,
  type AppNotification,
} from "@/lib/notifications-api";

const POLL_MS = 60_000;
const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = 380;
const GAP = 8;
const EDGE = 8;

interface PanelPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Where to draw the panel, in viewport coordinates.
 *
 * The panel is rendered in a portal on <body> rather than next to the button:
 * the desktop bell sits in a 260px sidebar column, so a 320px panel anchored to
 * the trigger ran off the left edge of the screen and got cut in half. Fixed
 * positioning + clamping keeps it fully on screen from either mount point, and
 * a portal means no ancestor's overflow or stacking context can clip it.
 */
function placePanel(rect: DOMRect): PanelPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(PANEL_WIDTH, vw - EDGE * 2);

  // Prefer aligning to the trigger's left edge, then pull it back inside.
  const left = Math.min(Math.max(EDGE, rect.left), vw - width - EDGE);

  const below = vh - rect.bottom - GAP - EDGE;
  const above = rect.top - GAP - EDGE;
  const openDown = below >= Math.min(PANEL_MAX_HEIGHT, above);
  const maxHeight = Math.max(
    160,
    Math.min(PANEL_MAX_HEIGHT, openDown ? below : above)
  );
  const top = openDown ? rect.bottom + GAP : Math.max(EDGE, rect.top - GAP - maxHeight);

  return { top, left, width, maxHeight };
}

/**
 * Event key -> translated message. Notifications are produced server-side in
 * English (the email needs a rendered string), so the dashboard re-renders the
 * known ones from this map in the customer's own language. Anything not listed
 * — older rows, or an event added later — falls back to the stored English
 * text, which is why `content` is still written for every notification.
 *
 * Listed explicitly rather than built from the key so the message ids stay
 * compile-checked.
 */
const EVENT_MESSAGES: Record<string, MessageKey> = {
  channelReconnect: "notifications.events.channelReconnect",
  postFailedReconnect: "notifications.events.postFailedReconnect",
  postFailedDisabled: "notifications.events.postFailedDisabled",
  postPublished: "notifications.events.postPublished",
  approvalRequested: "notifications.events.approvalRequested",
  approvalApproved: "notifications.events.approvalApproved",
  approvalRejected: "notifications.events.approvalRejected",
  approvalRejectedNote: "notifications.events.approvalRejectedNote",
  publishingPaused: "notifications.events.publishingPaused",
  publishingResumed: "notifications.events.publishingResumed",
};

/**
 * Links are stored absolute (the backend builds them from FRONTEND_URL, since
 * the same text is reused in the email). Inside the dashboard we want an
 * in-app navigation, and we must never follow a link to some other host that
 * ended up in the column.
 */
function toRelative(link: string): string {
  try {
    const url = new URL(link, window.location.origin);
    return url.origin === window.location.origin
      ? url.pathname + url.search
      : "/calendar";
  } catch {
    return link.startsWith("/") ? link : "/calendar";
  }
}

/**
 * Notification bell for the dashboard.
 *
 * The backend already records every notable event (publish succeeded, publish
 * failed, "reconnect this channel", approval requests) — nothing here creates
 * notifications, it only finally shows them. Before this, the only delivery
 * channel was email, so a channel that needed reconnecting could sit dead for
 * days with the user having no in-product signal at all.
 *
 * Opening the panel marks everything read server-side, so the list is fetched
 * on open only; the poll asks for the count alone.
 */
export function NotificationsBell({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [clearing, setClearing] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      setCount(await getNotificationCount());
    } catch {
      // Never surface a failed poll — the bell is ambient, not a task.
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = setInterval(() => void refreshCount(), POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  // Close on outside click and on Escape, like the other dropdowns in the shell.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel lives in a portal, so it is NOT inside wrapRef — check both
      // or every click inside the list would close it.
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPos(placePanel(rect));
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos(placePanel(rect));
    setOpen(true);
    setItems(null);
    setFailed(false);
    try {
      const res = await getNotificationList();
      setItems(res?.notifications ?? []);
      // The server bumped lastReadNotifications while serving that list, so the
      // badge is stale by definition now.
      setCount(0);
    } catch {
      setFailed(true);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await clearNotifications();
      setItems([]);
      setCount(0);
    } catch {
      setFailed(true);
    } finally {
      setClearing(false);
    }
  };

  const textOf = (n: AppNotification) => {
    const key = n.eventKey ? EVENT_MESSAGES[n.eventKey] : undefined;
    if (!key) return n.content;
    let params: Record<string, string> = {};
    if (n.eventParams) {
      try {
        params = JSON.parse(n.eventParams) ?? {};
      } catch {
        // Malformed params must not blank the notification — show the English
        // text rather than a message full of empty placeholders.
        return n.content;
      }
    }
    return t(key, params);
  };

  const formatWhen = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => void toggle()}
        aria-label={
          count > 0
            ? t("notifications.unread", { count })
            : t("notifications.title")
        }
        aria-expanded={open}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: compact ? "center" : "flex-start",
          gap: 8,
          width: compact ? 44 : "100%",
          height: compact ? 44 : 40,
          padding: compact ? 0 : "0 10px",
          border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg)",
          color: "inherit",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M8 2a4 4 0 0 0-4 4v2.5L2.8 10.7A.5.5 0 0 0 3.2 11.5h9.6a.5.5 0 0 0 .44-.8L12 8.5V6a4 4 0 0 0-4-4Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path
            d="M6.4 13a1.7 1.7 0 0 0 3.2 0"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        {!compact && <span>{t("notifications.title")}</span>}
        {count > 0 && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: compact ? 6 : 2,
              right: compact ? 6 : 8,
              minWidth: 17,
              height: 17,
              padding: "0 4px",
              borderRadius: 9,
              background: "var(--fg)",
              color: "var(--bg)",
              fontSize: 10,
              fontWeight: 700,
              lineHeight: "17px",
              textAlign: "center",
            }}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("notifications.title")}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            display: "flex",
            flexDirection: "column",
            background: "var(--bg)",
            border: "1px solid var(--line-soft)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 200,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "10px 12px",
              borderBottom: "1px solid var(--line-soft)",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {t("notifications.title")}
            </span>
            <button
              type="button"
              onClick={() => void clearAll()}
              disabled={clearing || !items || items.length === 0}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                fontSize: 12,
                color: "var(--muted)",
                cursor:
                  clearing || !items || items.length === 0 ? "default" : "pointer",
                opacity: clearing || !items || items.length === 0 ? 0.45 : 1,
              }}
            >
              {t("notifications.clear")}
            </button>
          </div>
          <div style={{ overflowY: "auto", padding: 6 }}>
          {items === null && !failed && (
            <p style={{ padding: 12, fontSize: 13, color: "var(--muted)" }}>
              {t("notifications.loading")}
            </p>
          )}
          {failed && (
            <p role="alert" style={{ padding: 12, fontSize: 13, color: "var(--muted)" }}>
              {t("notifications.error")}
            </p>
          )}
          {items?.length === 0 && (
            <p style={{ padding: 12, fontSize: 13, color: "var(--muted)" }}>
              {t("notifications.empty")}
            </p>
          )}
          {items?.map((n, i) => (
            <div
              key={`${n.createdAt}-${i}`}
              style={{
                padding: "10px 12px",
                borderBottom:
                  i === items.length - 1 ? "none" : "1px solid var(--line-soft)",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <span style={{ fontSize: 13, lineHeight: 1.35, wordBreak: "break-word" }}>
                {textOf(n)}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                {formatWhen(n.createdAt)}
                {n.link && (
                  <a
                    href={toRelative(n.link)}
                    onClick={() => setOpen(false)}
                    style={{ color: "var(--fg)", fontWeight: 600 }}
                  >
                    {t("notifications.action")}
                  </a>
                )}
              </span>
            </div>
          ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
