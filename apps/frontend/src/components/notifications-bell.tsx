"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { ConfirmDialog } from "./confirm-dialog";
import { NotificationGroups } from "./notification-list";
import {
  NOTIFICATIONS_READ_EVENT,
  clearNotifications,
  getNotificationCount,
  getNotificationList,
  type AppNotification,
} from "@/lib/notifications-api";

const POLL_MS = 60_000;
const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 440;
const GAP = 8;
const EDGE = 8;
/** Below this the panel becomes a bottom sheet instead of a dropdown. */
const SHEET_BREAKPOINT = 600;

interface PanelPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  sheet: boolean;
}

/**
 * Where to draw the panel, in viewport coordinates.
 *
 * The panel is rendered in a portal on <body> rather than next to the button:
 * the desktop bell sits in a 260px sidebar column, so a wider panel anchored to
 * the trigger ran off the left edge of the screen and got cut in half. Fixed
 * positioning + clamping keeps it fully on screen from either mount point, and
 * a portal means no ancestor's overflow or stacking context can clip it.
 *
 * On a phone the same dropdown was a cramped floating card next to a 44px
 * button, so there it becomes a bottom sheet: full width, thumb reachable.
 */
function placePanel(rect: DOMRect): PanelPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (vw <= SHEET_BREAKPOINT) {
    const maxHeight = Math.min(Math.round(vh * 0.7), PANEL_MAX_HEIGHT + 80);
    return {
      top: vh - maxHeight - EDGE,
      left: EDGE,
      width: vw - EDGE * 2,
      maxHeight,
      sheet: true,
    };
  }

  const width = Math.min(PANEL_WIDTH, vw - EDGE * 2);

  // Prefer aligning to the trigger's left edge, then pull it back inside.
  const left = Math.min(Math.max(EDGE, rect.left), vw - width - EDGE);

  const below = vh - rect.bottom - GAP - EDGE;
  const above = rect.top - GAP - EDGE;
  const openDown = below >= Math.min(PANEL_MAX_HEIGHT, above);
  const maxHeight = Math.max(
    200,
    Math.min(PANEL_MAX_HEIGHT, openDown ? below : above)
  );
  const top = openDown ? rect.bottom + GAP : Math.max(EDGE, rect.top - GAP - maxHeight);

  return { top, left, width, maxHeight, sheet: false };
}

/**
 * Notification bell for the dashboard.
 *
 * The backend already records every notable event (publish succeeded, publish
 * failed, "reconnect this channel", approval requests) - nothing here creates
 * notifications, it only finally shows them. Before this, the only delivery
 * channel was email, so a channel that needed reconnecting could sit dead for
 * days with the user having no in-product signal at all.
 *
 * Opening the panel marks everything read server-side, so the list is fetched
 * on open only; the poll asks for the count alone. The read mark the server
 * returns is the one from BEFORE that bump, which is what flags the new rows.
 */
export function NotificationsBell({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      setCount(await getNotificationCount());
    } catch {
      // Never surface a failed poll - the bell is ambient, not a task.
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = setInterval(() => void refreshCount(), POLL_MS);
    // The notifications page marks everything read as it loads. Without this
    // the badge kept claiming unread items for the rest of the poll interval,
    // on the one screen where the reader had just read them.
    const onRead = () => setCount(0);
    window.addEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    };
  }, [refreshCount]);

  const close = useCallback(() => {
    setOpen(false);
    // Send focus back where it came from, or a keyboard user is stranded at
    // the top of the document every time the panel closes.
    triggerRef.current?.focus();
  }, []);

  // Close on outside click and on Escape, like the other dropdowns in the shell.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel lives in a portal, so it is NOT inside wrapRef - check both
      // or every click inside the list would close it.
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      // Keep Tab inside the panel while it is open: it is a dialog, and
      // tabbing out of it leaves an open overlay behind the focus ring.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
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
  }, [open, close]);

  // Move focus into the panel once it is mounted so screen readers announce it.
  useEffect(() => {
    if (open && pos) panelRef.current?.focus();
  }, [open, pos]);

  const toggle = async () => {
    if (open) {
      close();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos(placePanel(rect));
    setOpen(true);
    setItems(null);
    setLastReadAt(null);
    setFailed(false);
    try {
      const res = await getNotificationList();
      setItems(res?.notifications ?? []);
      setLastReadAt(res?.lastReadNotifications ?? null);
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
      setConfirmClear(false);
    } catch {
      setFailed(true);
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  };

  const nothingToClear = !items || items.length === 0;

  const linkStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    padding: 0,
    fontSize: 12,
    color: "var(--muted)",
    textDecoration: "none",
    cursor: "pointer",
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
        aria-haspopup="dialog"
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
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {/* Announced without stealing focus, so a new alert is not silent. */}
      <span
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {count > 0 ? t("notifications.unread", { count }) : ""}
      </span>

      {open && pos && createPortal(
        <>
        {/* The sheet covers most of a phone screen, so it gets a real scrim -
            without it the page behind still looks like the active surface. */}
        {pos.sheet && (
          <div
            aria-hidden
            onClick={close}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 199,
              background: "rgba(0,0,0,0.35)",
            }}
          />
        )}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal={pos.sheet}
          tabIndex={-1}
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
            borderRadius: pos.sheet ? "var(--radius-lg)" : 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
            zIndex: 200,
            overflow: "hidden",
            outline: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "12px 14px",
              borderBottom: "1px solid var(--line-soft)",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {t("notifications.title")}
            </span>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={clearing || nothingToClear}
              style={{
                ...linkStyle,
                cursor: clearing || nothingToClear ? "default" : "pointer",
                opacity: clearing || nothingToClear ? 0.45 : 1,
              }}
            >
              {t("notifications.clear")}
            </button>
          </div>

          <div style={{ overflowY: "auto", padding: 6, flex: 1 }}>
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
            {items?.length === 0 && !failed && (
              <p style={{ padding: 12, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                {t("notifications.empty")}
              </p>
            )}
            {items && items.length > 0 && (
              <NotificationGroups
                items={items}
                lastReadAt={lastReadAt}
                onNavigate={() => setOpen(false)}
                compact
              />
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "10px 14px",
              borderTop: "1px solid var(--line-soft)",
              flexShrink: 0,
            }}
          >
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              style={{ ...linkStyle, color: "var(--fg)", fontWeight: 600 }}
            >
              {t("notifications.seeAll")}
            </Link>
          </div>
        </div>
        </>,
        document.body
      )}

      {confirmClear && (
        <ConfirmDialog
          title={t("notifications.clearConfirmTitle")}
          body={t("notifications.clearConfirmBody")}
          confirmLabel={t("notifications.clear")}
          danger
          busy={clearing}
          onConfirm={() => void clearAll()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
