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

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 13,
  cursor: "pointer",
};

export default function ApprovalPage() {
  const { user } = useAuth();
  const t = useT();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [items, setItems] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const refresh = async () => {
    try {
      setItems((await getPendingApprovals()) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("approval.loadError" as any));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      setItems((p) => p.filter((x) => x.id !== id));
      setRejectFor(null);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("approval.actionError" as any));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>{t("approval.eyebrow" as any)}</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 6px" }}>{t("approval.title" as any)}</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
          {isAdmin
            ? t("approval.subtitleAdmin" as any)
            : t("approval.subtitleMember" as any)}
        </p>
      </div>

      {error && (
        <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading" as any)}</div>
      ) : items.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{t("approval.empty" as any)}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((a) => (
            <div key={a.id} style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: "var(--muted)" }}>
                <span>{a.post?.integration?.name ?? t("approval.channelFallback" as any)}</span>
                <span>{t("approval.requestedBy" as any, { name: a.requestedBy?.name || a.requestedBy?.email || t("approval.someone" as any) })}</span>
              </div>
              <div style={{ fontSize: 14, whiteSpace: "pre-wrap", color: "var(--fg)" }}>
                {(a.post?.content || "").slice(0, 280) || t("approval.noText" as any)}
              </div>
              {isAdmin && (
                rejectFor === a.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t("approval.reasonPlaceholder" as any)}
                      style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line-soft)", fontSize: 16, background: "var(--bg)", color: "var(--fg)", minHeight: 60, resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" style={{ ...ghostBtn, color: "#DC2626", borderColor: "rgba(220,38,38,0.25)" }} disabled={busyId === a.id} onClick={() => act(a.id, () => rejectPost(a.id, note || undefined))}>{t("approval.confirmReject" as any)}</button>
                      <button type="button" style={ghostBtn} onClick={() => { setRejectFor(null); setNote(""); }}>{t("common.cancel" as any)}</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" style={{ ...ghostBtn, background: "var(--fg)", color: "var(--bg)", border: "none", fontWeight: 600 }} disabled={busyId === a.id} onClick={() => act(a.id, () => approvePost(a.id))}>{t("approval.approveSchedule" as any)}</button>
                    <button type="button" style={ghostBtn} disabled={busyId === a.id} onClick={() => setRejectFor(a.id)}>{t("approval.reject" as any)}</button>
                  </div>
                )
              )}
              {!isAdmin && (
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{t("approval.pendingReview" as any)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
