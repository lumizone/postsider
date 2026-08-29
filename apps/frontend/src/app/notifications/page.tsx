"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { NotificationGroups } from "@/components/notification-list";
import {
  announceNotificationsRead,
  clearNotifications,
  getNotificationsPage,
  type AppNotification,
} from "@/lib/notifications-api";

/**
 * Full notification history.
 *
 * The bell shows the latest 10, which is right for a dropdown and useless for
 * an organization that has accumulated hundreds of publish results and channel
 * alerts. This is the "see all" behind it: same rendering, day headers, and the
 * same new/read distinction, but paged over the whole list.
 */
export default function NotificationsPage() {
  const t = useT();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await getNotificationsPage(0);
      setItems(res.notifications ?? []);
      // The read mark from BEFORE this fetch bumped it, so rows that arrived
      // since the reader's last visit still show as new on this first render.
      setLastReadAt(res.lastReadNotifications ?? null);
      setHasMore(res.hasMore);
      setTotal(res.total);
      setPage(0);
      // Page 0 bumped the read mark server-side; tell the bell so its badge
      // does not sit on a stale count until the next poll.
      announceNotificationsRead();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await getNotificationsPage(next);
      setItems((prev) => [...prev, ...(res.notifications ?? [])]);
      setHasMore(res.hasMore);
      setPage(next);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await clearNotifications();
      setItems([]);
      setTotal(0);
      setHasMore(false);
    } catch {
      setError(true);
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "32px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--muted)",
            }}
          >
            {t("notifications.eyebrow")}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 6px" }}>
            {t("notifications.title")}
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
            {t("notifications.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          disabled={clearing || items.length === 0}
          style={{
            padding: "8px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line-soft)",
            background: "var(--bg)",
            color: "var(--fg)",
            fontSize: 13,
            cursor: clearing || items.length === 0 ? "default" : "pointer",
            opacity: clearing || items.length === 0 ? 0.45 : 1,
          }}
        >
          {t("notifications.clear")}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            fontSize: 13,
          }}
        >
          {t("notifications.error")}
        </div>
      )}

      {loading ? (
        <div
          style={{
            padding: "30px 0",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          {t("notifications.loading")}
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: "40px 0",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {t("notifications.empty")}
        </div>
      ) : (
        <>
          <div
            style={{
              border: "1px solid var(--line-soft)",
              borderRadius: "var(--radius-md)",
              padding: 8,
            }}
          >
            <NotificationGroups items={items} lastReadAt={lastReadAt} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            <span>
              {t("notifications.shownOf", { shown: items.length, total })}
            </span>
            {hasMore && (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                style={{
                  padding: "8px 14px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--line-soft)",
                  background: "var(--bg)",
                  color: "var(--fg)",
                  fontSize: 13,
                  cursor: loadingMore ? "default" : "pointer",
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                {loadingMore
                  ? t("notifications.loading")
                  : t("notifications.loadMore")}
              </button>
            )}
          </div>
        </>
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
