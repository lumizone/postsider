"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  getGuestReview,
  resolveGuestReview,
  type GuestReviewPost,
} from "@/lib/guest-review-api";

const primaryBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 14,
  cursor: "pointer",
};

function parseMediaUrls(imageJson?: string | null): string[] {
  if (!imageJson) return [];
  try {
    const arr = JSON.parse(imageJson);
    if (!Array.isArray(arr)) return [];
    return arr.map((m: any) => m?.path || m?.url || "").filter(Boolean);
  } catch {
    return [];
  }
}

export function GuestReviewView({ token }: { token: string }) {
  const t = useT();
  const [post, setPost] = useState<GuestReviewPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getGuestReview(token)
      .then((p) => setPost(p))
      .catch((e) =>
        setError(e instanceof Error ? e.message : t("guestReview.loadError")),
      )
      .finally(() => setLoading(false));
  }, [token, t]);

  const act = async (action: "approve" | "reject") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await resolveGuestReview(token, action, action === "reject" ? note : undefined);
      setResolved(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("guestReview.actionError"));
    } finally {
      setBusy(false);
    }
  };

  const mediaUrls = parseMediaUrls(post?.image);

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px" }}>
      <div style={{ marginBottom: 24 }}>
        {post?.branding?.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.branding.logo} alt={post.branding.name} style={{ maxWidth: 180, maxHeight: 48, objectFit: "contain", marginBottom: 14 }} />
        )}
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
          {t("guestReview.eyebrow")}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0" }}>{post?.branding?.name ? `${post.branding.name} · ${t("guestReview.title")}` : t("guestReview.title")}</h1>
      </div>

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
          {t("common.loading")}
        </div>
      ) : resolved ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {resolved === "approve" ? t("guestReview.approvedThanks") : t("guestReview.rejectedThanks")}
          </div>
        </div>
      ) : error && !post ? (
        <div role="alert" style={{ padding: "16px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 14 }}>
          {error}
        </div>
      ) : post ? (
        <div style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {post.channel?.name ?? t("guestReview.channelFallback")}
            {post.publishDate && (
              <> · {new Date(post.publishDate).toLocaleString()}</>
            )}
          </div>

          {mediaUrls.length > 0 && (
            <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
              {mediaUrls.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={url}
                  alt=""
                  style={{ width: 120, height: 120, borderRadius: 8, objectFit: "cover", border: "1px solid var(--line-soft)" }}
                />
              ))}
            </div>
          )}

          <div style={{ fontSize: 15, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {post.content || t("guestReview.noText")}
          </div>

          {error && (
            <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>
              {error}
            </div>
          )}

          {rejecting ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("guestReview.reasonPlaceholder")}
                rows={3}
                style={{ borderRadius: 8, border: "1px solid var(--line-soft)", background: "var(--bg)", color: "var(--fg)", padding: 10, fontSize: 14 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={{ ...ghostBtn, color: "var(--danger-bright)", borderColor: "color-mix(in srgb, var(--danger) 38%, transparent)" }} disabled={busy} onClick={() => act("reject")}>
                  {t("guestReview.confirmReject")}
                </button>
                <button type="button" style={ghostBtn} onClick={() => setRejecting(false)}>{t("common.cancel")}</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" style={primaryBtn} disabled={busy} onClick={() => act("approve")}>
                {t("guestReview.approve")}
              </button>
              <button type="button" style={ghostBtn} disabled={busy} onClick={() => setRejecting(true)}>
                {t("guestReview.reject")}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
