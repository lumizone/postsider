"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  getGuestReview,
  resolveGuestReview,
  type GuestReviewPost,
} from "@/lib/guest-review-api";
import {
  GUEST_EMAIL_MAX,
  GUEST_NAME_MAX,
  validateGuestIdentity,
  type GuestIdentityError,
} from "@/lib/guest-review-identity";

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
const inputStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  padding: "9px 10px",
  fontSize: 14,
};
const fieldLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--fg)",
};
const fieldError: React.CSSProperties = {
  fontSize: 12,
  color: "var(--danger)",
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
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [identityError, setIdentityError] = useState<GuestIdentityError | null>(null);

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
    const identity = validateGuestIdentity(guestName, guestEmail);
    if (!identity.ok) {
      setIdentityError(identity.error);
      return;
    }
    setIdentityError(null);
    setBusy(true);
    setError(null);
    try {
      await resolveGuestReview(
        token,
        action,
        { name: identity.name, email: identity.email },
        action === "reject" ? note : undefined,
      );
      setResolved(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("guestReview.actionError"));
    } finally {
      setBusy(false);
    }
  };

  const mediaUrls = parseMediaUrls(post?.image);
  const nameError =
    identityError === "nameRequired" || identityError === "nameTooLong" ? identityError : null;
  const emailError =
    identityError === "emailRequired" ||
    identityError === "emailInvalid" ||
    identityError === "emailTooLong"
      ? identityError
      : null;

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

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="guest-review-name" style={fieldLabel}>
                {t("guestReview.nameLabel")}
              </label>
              <input
                id="guest-review-name"
                type="text"
                required
                autoComplete="name"
                maxLength={GUEST_NAME_MAX + 40}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "guest-review-name-error" : undefined}
                style={inputStyle}
              />
              {nameError && (
                <div id="guest-review-name-error" role="alert" style={fieldError}>
                  {t(`guestReview.${nameError}`)}
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="guest-review-email" style={fieldLabel}>
                {t("guestReview.emailLabel")}
              </label>
              <input
                id="guest-review-email"
                type="email"
                required
                autoComplete="email"
                maxLength={GUEST_EMAIL_MAX + 40}
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "guest-review-email-error" : undefined}
                style={inputStyle}
              />
              {emailError && (
                <div id="guest-review-email-error" role="alert" style={fieldError}>
                  {t(`guestReview.${emailError}`)}
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("guestReview.identityHint")}</div>
          </div>

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
