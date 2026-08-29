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
import {
  fetchPostDetail,
  type PostDetailItem,
  type PostMedia,
} from "@/lib/posts";

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

/** Render the post's media as a full-width preview (first item large, rest as a strip). */
function PostMediaPreview({ media }: { media?: PostMedia[] }) {
  if (!media || media.length === 0) return null;
  const [first, ...rest] = media;
  const isVideo = first.kind === "video";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          width: "100%",
          aspectRatio: isVideo ? "auto" : "auto",
          maxHeight: 340,
          borderRadius: 10,
          overflow: "hidden",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {first.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={first.url}
            alt=""
            style={{ width: "100%", height: "auto", maxHeight: 340, objectFit: "contain" }}
          />
        ) : (
          <video
            src={first.url}
            controls
            playsInline
            style={{ width: "100%", maxHeight: 340, objectFit: "contain" }}
          />
        )}
      </span>
      {rest.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rest.map((m) => (
            <span key={m.id ?? m.url} style={{ width: 88, aspectRatio: "1 / 1", borderRadius: 8, overflow: "hidden", background: "#000", display: "block" }}>
              {m.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <video src={m.url} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Render the post's content chain (main post + thread parts) as plain text. */
function PostContent({ posts }: { posts: PostDetailItem[] }) {
  if (!posts || posts.length === 0) return null;
  const [main, ...rest] = posts;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {main.content && (
        <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
          {main.content}
        </p>
      )}
      {rest.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderLeft: "2px solid var(--line-soft)", paddingLeft: 10 }}>
          {rest.map((p, i) => (
            <p key={i} style={{ margin: 0, fontSize: 13, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
              {p.content}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function PostDetailDrawer({ postId, status, onClose }: PostDetailDrawerProps) {
  const t = useT();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [analytics, setAnalytics] = useState<PostAnalyticsResponse | null>(null);
  const [post, setPost] = useState<PostDetailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, a, d] = await Promise.all([
          getPostComments(postId),
          status === "published" ? getPostAnalytics(postId) : Promise.resolve(null),
          fetchPostDetail(postId).catch(() => null),
        ]);
        if (!cancelled) {
          setComments(c);
          setAnalytics(a);
          setPost(d?.posts ?? []);
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
        background: "var(--scrim)",
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
          <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>{error}</div>
        )}

        {loading ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
        ) : (
          <>
            {(post.length > 0) && (
              <section style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 8, borderBottom: "1px solid var(--line-soft)" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{t("postDetail.preview")}</span>
                <PostMediaPreview media={post[0]?.image} />
                <PostContent posts={post} />
              </section>
            )}

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
                      <div key={series.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid rgb(var(--tint) / 0.05)" }}>
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
