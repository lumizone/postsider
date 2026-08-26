"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  PendingApproval,
  getPendingApprovals,
  approvePost,
  rejectPost,
  createGuestLink,
} from "@/lib/approval-api";
import { parsePostMedia, type PostMedia } from "@/lib/posts";
import { platformFromIdentifier } from "@/lib/integrations";
import { PlatformIcon } from "@/components/platform-icon";
import ap from "./approval.module.css";

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 13,
  cursor: "pointer",
};

/** Full-width media preview: first item large, remaining as a strip. */
function MediaPreview({ media }: { media: PostMedia[] }) {
  if (!media || media.length === 0) return null;
  const [first, ...rest] = media;
  const isVideo = first.kind === "video";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          width: "100%",
          borderRadius: 10,
          overflow: "hidden",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          maxHeight: 420,
        }}
      >
        {isVideo ? (
          <video
            src={first.url}
            controls
            muted
            playsInline
            style={{ width: "100%", maxHeight: 420, objectFit: "contain" }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={first.url}
            alt=""
            style={{ width: "100%", maxHeight: 420, objectFit: "contain" }}
          />
        )}
      </div>
      {rest.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rest.map((m, i) => (
            <span key={i} style={{ width: 72, height: 72, borderRadius: 8, overflow: "hidden", background: "#000", display: "block" }}>
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

function shortDay(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ApprovalPage() {
  const { user } = useAuth();
  const t = useT();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [items, setItems] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // Track which post content sections are expanded (default: first 280 chars)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = async () => {
    try {
      const res = await getPendingApprovals();
      setItems(Array.isArray(res) ? res : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("approval.loadError"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    if (busyIds.has(id)) return;
    setBusyIds((s) => new Set(s).add(id));
    setError(null);
    try {
      await fn();
      setItems((p) => p.filter((x) => x.id !== id));
      setRejectFor(null);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("approval.actionError"));
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);
  const [linkMsgFor, setLinkMsgFor] = useState<string | null>(null);

  const getGuestLink = async (id: string) => {
    if (linkBusyId) return;
    setLinkBusyId(id);
    setLinkMsgFor(null);
    setError(null);
    try {
      const { token } = await createGuestLink(id);
      const url = `${window.location.origin}/review/${token}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Clipboard API can be denied — the message below still shows the ask.
      }
      setLinkMsgFor(id);
      setTimeout(() => setLinkMsgFor((cur) => (cur === id ? null : cur)), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("approval.guestLinkError"));
    } finally {
      setLinkBusyId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>{t("approval.eyebrow")}</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 6px" }}>{t("approval.title")}</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
          {isAdmin
            ? t("approval.subtitleAdmin")
            : t("approval.subtitleMember")}
        </p>
      </div>

      {error && (
        <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
      ) : items.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{t("approval.empty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((a) => {
            const media = parsePostMedia(a.post?.image);
            const content = a.post?.content || "";
            const isLong = content.length > 280;
            const showFull = expanded.has(a.id);
            const displayContent = showFull || !isLong ? content : content.slice(0, 280) + "…";
            const provider = a.post?.integration?.providerIdentifier;
            const platform = platformFromIdentifier(provider ?? "");
            const channelName = a.post?.integration?.name ?? t("approval.channelFallback");
            const picture = a.post?.integration?.picture;
            const images = media.filter((m) => m.kind === "image").length;
            const videos = media.filter((m) => m.kind === "video").length;

            return (
              <div key={a.id} style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Header row: channel avatar/platform + requester + date */}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={picture}
                        alt=""
                        style={{ width: 30, height: 30, borderRadius: 7, objectFit: "cover", background: "rgb(var(--tint) / 0.06)" }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 30, height: 30, borderRadius: 7,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          background: "var(--fg)", color: "var(--bg)",
                          fontSize: 12, fontWeight: 700,
                        }}
                      >
                        {channelName.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.25 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {channelName}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)" }}>
                        {platform && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 22,
                              height: 22,
                              borderRadius: 6,
                              background: "rgb(var(--tint) / 0.05)",
                              flexShrink: 0,
                            }}
                          >
                            <PlatformIcon platform={platform} size={18} />
                          </span>
                        )}
                        {platform}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 12, color: "var(--muted)", gap: 2 }}>
                    <span>{t("approval.requestedBy", { name: a.requestedBy?.name || a.requestedBy?.email || t("approval.someone") })}</span>
                    {a.post?.publishDate && (
                      <span>{t("approval.scheduledFor")}: {shortDay(a.post.publishDate)}</span>
                    )}
                  </div>
                </div>

                {/* Media type summary + count */}
                {media.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {media.length} {media.length === 1 ? t("media.image").toLowerCase() : t("approval.mediaItems")}
                    {images > 0 && ` · ${images} ${t("approval.images")}`}
                    {videos > 0 && ` · ${videos} ${t("approval.videos")}`}
                  </div>
                )}

                {/* Large media preview */}
                {media.length > 0 && <MediaPreview media={media} />}

                {/* Post content */}
                <div style={{ fontSize: 14, whiteSpace: "pre-wrap", color: "var(--fg)", wordBreak: "break-word" }}>
                  {displayContent || t("approval.noText")}
                </div>
                {isLong && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(a.id)}
                    style={{ ...ghostBtn, padding: "2px 8px", fontSize: 12, alignSelf: "flex-start" }}
                  >
                    {showFull ? t("approval.showLess") : t("approval.showMore")}
                  </button>
                )}

                {/* Admin: approve / reject */}
                {isAdmin && (
                  rejectFor === a.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t("approval.reasonPlaceholder")}
                        className={ap.reasonInput}
                      />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" style={{ ...ghostBtn, color: "var(--danger-bright)", borderColor: "color-mix(in srgb, var(--danger) 38%, transparent)" }} disabled={busyIds.has(a.id)} onClick={() => act(a.id, () => rejectPost(a.id, note || undefined))}>{t("approval.confirmReject")}</button>
                        <button type="button" style={ghostBtn} onClick={() => { setRejectFor(null); setNote(""); }}>{t("common.cancel")}</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" style={{ ...ghostBtn, background: "var(--fg)", color: "var(--bg)", border: "none", fontWeight: 600 }} disabled={busyIds.has(a.id)} onClick={() => act(a.id, () => approvePost(a.id))}>{t("approval.approveSchedule")}</button>
                        <button type="button" style={ghostBtn} disabled={busyIds.has(a.id)} onClick={() => { setRejectFor(a.id); setNote(""); }}>{t("approval.reject")}</button>
                        <button type="button" style={ghostBtn} disabled={linkBusyId === a.id} onClick={() => getGuestLink(a.id)}>{t("approval.guestLink")}</button>
                      </div>
                      {linkMsgFor === a.id && (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("approval.guestLinkCreated")}</span>
                      )}
                    </div>
                  )
                )}
                {!isAdmin && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{t("approval.pendingReview")}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
