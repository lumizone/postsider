"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  PendingApproval,
  getPendingApprovals,
  approvePost,
  rejectPost,
} from "@/lib/approval-api";
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

/** Parse the `post.image` JSON column (stringified `[ { path: string } ]`) into url strings. */
function parseMediaUrls(imageJson?: string): string[] {
  if (!imageJson) return [];
  try {
    const arr = JSON.parse(imageJson);
    if (!Array.isArray(arr)) return [];
    return arr.map((m: any) => m?.path || m?.url || "").filter(Boolean);
  } catch {
    return [];
  }
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
      setItems((await getPendingApprovals()) || []);
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
        <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
      ) : items.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{t("approval.empty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((a) => {
            const mediaUrls = parseMediaUrls(a.post?.image);
            const content = a.post?.content || "";
            const isLong = content.length > 280;
            const showFull = expanded.has(a.id);
            const displayContent = showFull || !isLong ? content : content.slice(0, 280) + "…";

            return (
              <div key={a.id} style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Header row: channel + requester + date */}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
                  <span>
                    {a.post?.integration?.name ?? t("approval.channelFallback")}
                    <span style={{ marginLeft: 6, opacity: 0.6 }}>{a.post?.integration?.providerIdentifier}</span>
                  </span>
                  <span>{t("approval.requestedBy", { name: a.requestedBy?.name || a.requestedBy?.email || t("approval.someone") })}</span>
                </div>

                {/* Publish date if set */}
                {a.post?.publishDate && (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {t("approval.scheduledFor")}: {shortDay(a.post.publishDate)}
                  </div>
                )}

                {/* Media thumbnails */}
                {mediaUrls.length > 0 && (
                  <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                    {mediaUrls.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt=""
                        style={{
                          width: 80, height: 80, borderRadius: 8,
                          objectFit: "cover", border: "1px solid var(--line-soft)",
                        }}
                      />
                    ))}
                  </div>
                )}

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
                        <button type="button" style={{ ...ghostBtn, color: "#DC2626", borderColor: "rgba(220,38,38,0.25)" }} disabled={busyIds.has(a.id)} onClick={() => act(a.id, () => rejectPost(a.id, note || undefined))}>{t("approval.confirmReject")}</button>
                        <button type="button" style={ghostBtn} onClick={() => { setRejectFor(null); setNote(""); }}>{t("common.cancel")}</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" style={{ ...ghostBtn, background: "var(--fg)", color: "var(--bg)", border: "none", fontWeight: 600 }} disabled={busyIds.has(a.id)} onClick={() => act(a.id, () => approvePost(a.id))}>{t("approval.approveSchedule")}</button>
                      <button type="button" style={ghostBtn} disabled={busyIds.has(a.id)} onClick={() => { setRejectFor(a.id); setNote(""); }}>{t("approval.reject")}</button>
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
