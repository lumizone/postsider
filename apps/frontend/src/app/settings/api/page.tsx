"use client";

import { useEffect, useState } from "react";
import {
  PageHeader,
  Card,
  settingsStyles as s,
} from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api";
import { ApiRequestGenerator } from "@/components/api-request-generator";

interface ApiKeyRow {
  id: string;
  name: string;
  key: string; // hashed — only raw at creation
  createdAt: string;
}

function maskKey(key: string): string {
  if (!key || key.length <= 10) return "ps_••••••••••";
  if (key.startsWith("ps_")) return key.slice(0, 6) + "••••••••••••••••••" + key.slice(-4);
  return key.slice(0, 4) + "••••••••••••••••••" + key.slice(-4);
}

export default function ApiSettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Modal for newly created key
  const [showModal, setShowModal] = useState(false);
  const [revealedKey, setRevealedKey] = useState("");
  const [revealedName, setRevealedName] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    try {
      const res = await api.get<ApiKeyRow[]>("/settings/api-keys");
      setKeys(res || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load keys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<ApiKeyRow & { key: string }>("/settings/api-keys", {
        name: newName.trim(),
      });
      setRevealedKey(res.key);
      setRevealedName(res.name);
      setShowModal(true);
      setShowCreate(false);
      setNewName("");
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key");
    } finally {
      setCreating(false);
    }
  };

  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const onRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return;
    setRenameBusy(true);
    try {
      await api.put(`/settings/api-keys/${renameTarget.id}`, { name });
      setKeys((prev) =>
        prev.map((k) => (k.id === renameTarget.id ? { ...k, name } : k)),
      );
      setRenameTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
      setRenameTarget(null);
    } finally {
      setRenameBusy(false);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const onDelete = async (id: string) => {
    try {
      await api.del(`/settings/api-keys/${id}`);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleteTarget(null);
    }
  };

  const onCopy = () => {
    if (!revealedKey || !navigator?.clipboard) return;
    navigator.clipboard.writeText(revealedKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.api")}
        subtitle="You don't have permission to manage API keys."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsApi.title")}
        subtitle={t("settingsApi.subtitle")}
      />

      {error && (
        <div style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>
          {error}
        </div>
      )}

      <Card title="">
        {loading ? (
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
        ) : keys.length === 0 && !showCreate ? (
          <div style={{ padding: "40px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <svg width="28" height="28" viewBox="0 0 20 20" fill="none" style={{ color: "var(--muted)" }}>
              <path d="M12.5 2.5a4.5 4.5 0 0 0-4.1 6.36L2.5 14.75V17.5h2.75l.25-.25v-1.75H7.25l.25-.25v-1.75H9.25l1.14-1.14A4.5 4.5 0 1 0 12.5 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <circle cx="13.5" cy="6.5" r="1" fill="currentColor" />
            </svg>
            <span style={{ fontSize: 14, color: "var(--muted)" }}>{t("settingsApi.noKeys")}</span>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 480 }}>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 120px 70px", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line-soft)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
              <span>{t("settingsApi.colName")}</span>
              <span>{t("settingsApi.colKey")}</span>
              <span>{t("settingsApi.colCreated")}</span>
              <span />
            </div>

            {/* Rows */}
            {keys.map((k) => (
              <div key={k.id} style={{ display: "grid", gridTemplateColumns: "1fr 2fr 120px 70px", gap: 10, padding: "12px 0", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 13, alignItems: "center" }}>
                <span style={{ fontWeight: 500 }}>{k.name}</span>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>
                  {maskKey(k.key)}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {new Date(k.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                </span>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <IconBtn onClick={() => { setRenameTarget({ id: k.id, name: k.name }); setRenameValue(k.name); }} title={t("settingsApi.rename")}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
                  </IconBtn>
                  <IconBtn onClick={() => setDeleteTarget({ id: k.id, name: k.name })} title={t("settingsApi.revoke")} danger>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6 3h4M5.5 4.5l.5 8.5h4l.5-8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </IconBtn>
                </div>
              </div>
            ))}
            </div>
          </div>
        )}

        {/* Create */}
        <div style={{ marginTop: 16 }}>
          {showCreate ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("settingsApi.createPlaceholder")}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") void onCreate(); }}
                style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "1px solid var(--line-soft)", fontSize: 13, background: "var(--bg)", color: "var(--fg)" }}
              />
              <button type="button" onClick={onCreate} disabled={creating} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--fg)", color: "var(--bg)", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                {creating ? t("settingsApi.creating") : t("common.create")}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setNewName(""); }} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--line-soft)", background: "var(--bg)", fontSize: 13, cursor: "pointer" }}>
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowCreate(true)} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--line-soft)", background: "var(--bg)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
              {t("settingsApi.createBtn")}
            </button>
          )}
        </div>
      </Card>

      {/* Usage card */}
      <Card title={t("settingsApi.usageTitle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "var(--muted)" }}>
          <span>Pass the key in the <code style={{ background: "rgba(0,0,0,0.04)", padding: "2px 5px", borderRadius: 4 }}>Authorization</code> header:</span>
          <pre className={s.codeBlock} style={{ fontSize: 12, lineHeight: 1.7, padding: "14px 16px", borderRadius: 10 }}>{`curl ${process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000"}/public/v1/posts \\
  -H "Authorization: ps_your_key_here" \\
  -H "Content-Type: application/json"`}</pre>
        </div>
      </Card>

      <ApiRequestGenerator />

      {/* New key modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}>
          <div style={{ width: "100%", maxWidth: 480, background: "var(--bg)", borderRadius: 16, padding: "28px 24px 24px", boxShadow: "0 24px 64px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>{t("settingsApi.keyCreatedTitle")}</h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                {t("settingsApi.keyCreatedDesc", { name: revealedName })}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "rgba(0,0,0,0.03)", borderRadius: 10, border: "1px solid var(--line-soft)" }}>
              <span style={{ flex: 1, fontFamily: "monospace", fontSize: 14, fontWeight: 600, wordBreak: "break-all", lineHeight: 1.5, userSelect: "all" }}>
                {revealedKey}
              </span>
              <button
                type="button"
                onClick={onCopy}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line-soft)",
                  background: "var(--bg)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {copied ? t("settingsApi.copied") : t("settingsApi.copy")}
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowModal(false)} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "var(--fg)", color: "var(--bg)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {t("common.done")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Rename modal */}
      {renameTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }} onClick={() => !renameBusy && setRenameTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "var(--bg)", borderRadius: 16, padding: "28px 24px 24px", boxShadow: "0 24px 64px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>{t("settingsApi.renameTitle")}</h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                {t("settingsApi.renameDesc")}
              </p>
            </div>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void onRename(); }}
              placeholder={t("settingsApi.renamePlaceholder")}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line-soft)", fontSize: 14, background: "var(--bg)", color: "var(--fg)" }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setRenameTarget(null)} disabled={renameBusy} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid var(--line-soft)", background: "var(--bg)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                {t("common.cancel")}
              </button>
              <button type="button" onClick={() => void onRename()} disabled={renameBusy || !renameValue.trim()} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "var(--fg)", color: "var(--bg)", fontSize: 14, fontWeight: 600, cursor: renameValue.trim() ? "pointer" : "default", opacity: renameValue.trim() ? 1 : 0.5 }}>
                {renameBusy ? t("settingsApi.savingRename") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }} onClick={() => setDeleteTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "var(--bg)", borderRadius: 16, padding: "28px 24px 24px", boxShadow: "0 24px 64px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>{t("settingsApi.revokeConfirmTitle")}</h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                {t("settingsApi.revokeConfirmBody", { name: deleteTarget.name })}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid var(--line-soft)", background: "var(--bg)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void onDelete(deleteTarget.id)}
                style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "#DC2626", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                {t("settingsApi.revokeBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function IconBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        border: `1px solid ${danger ? "rgba(220,38,38,0.25)" : "var(--line-soft)"}`,
        background: "var(--bg)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: danger ? "#DC2626" : "var(--muted)",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}
