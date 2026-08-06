"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  getPostComments,
  addPostComment,
  getPostAnalytics,
  type PostComment,
  type PostAnalyticsResponse,
} from "@/lib/post-detail-api";
import type { PostStatus } from "@/lib/calendar-data";

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 13,
  cursor: "pointer",
};

interface PostDetailDrawerProps {
  postId: string;
  status: PostStatus;
  onClose: () => void;
}

export function PostDetailDrawer({ postId, status, onClose }: PostDetailDrawerProps) {
  const t = useT();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [analytics, setAnalytics] = useState<PostAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, a] = await Promise.all([
          getPostComments(postId),
          status === "published" ? getPostAnalytics(postId) : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setComments(c);
          setAnalytics(a);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("postDetail.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const onSend = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await addPostComment(postId, draft.trim());
      setComments((prev) => [...prev, created]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("postDetail.sendError"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("postDetail.title")}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          height: "100%",
          background: "var(--bg)",
          borderLeft: "1px solid var(--line-soft)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{t("postDetail.title")}</span>
          <button type="button" style={ghostBtn} onClick={onClose}>{t("postDetail.close")}</button>
        </div>

        {error && (
          <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>{error}</div>
        )}

        {loading ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
        ) : (
          <>
            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{t("postDetail.analyticsTitle")}</span>
              {status !== "published" ? (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("postDetail.analyticsNotPublished")}</span>
              ) : !analytics || (Array.isArray(analytics) && analytics.length === 0) ? (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("postDetail.analyticsEmpty")}</span>
              ) : "missing" in (analytics as any) ? (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("postDetail.analyticsMissing")}</span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(analytics as Exclude<PostAnalyticsResponse, { missing: true }>).map((series) => {
                    const total = series.data.reduce((sum, p) => sum + (Number(p.total) || 0), 0);
                    return (
                      <div key={series.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                        <span style={{ color: "var(--fg)" }}>{series.label}</span>
                        <span style={{ fontWeight: 600 }}>{total.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{t("postDetail.commentsTitle")}</span>
              {comments.length === 0 ? (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("postDetail.noComments")}</span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {comments.map((c) => (
                    <div key={c.id} style={{ fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 12 }}>
                        <span>{c.user?.name || c.user?.email || "?"}</span>
                        <span>{new Date(c.createdAt).toLocaleString()}</span>
                      </div>
                      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.content}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("postDetail.commentPlaceholder")}
                  rows={2}
                  style={{ flex: 1, borderRadius: 8, border: "1px solid var(--line-soft)", background: "var(--bg)", color: "var(--fg)", padding: 8, fontSize: 13, resize: "vertical" }}
                />
              </div>
              <button
                type="button"
                style={{ ...ghostBtn, alignSelf: "flex-end", opacity: draft.trim() && !sending ? 1 : 0.5 }}
                disabled={!draft.trim() || sending}
                onClick={onSend}
              >
                {t("postDetail.send")}
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
