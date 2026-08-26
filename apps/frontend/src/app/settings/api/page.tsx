"use client";

import { useEffect, useState } from "react";
import {
  PageHeader,
  Card,
  settingsStyles as s,
} from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { ApiRequestGenerator } from "@/components/api-request-generator";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
  const { t, locale } = useI18n();
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
      // A 200 that is not an array (a proxy page, a changed payload) used to
      // white-screen the route on `keys.map`.
      setKeys(Array.isArray(res) ? res : []);
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
  const [deleteBusy, setDeleteBusy] = useState(false);

  const onDelete = async (id: string) => {
    if (deleteBusy) return; // prevent a duplicate DELETE
    setDeleteBusy(true);
    try {
      await api.del(`/settings/api-keys/${id}`);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const onCopy = () => {
    if (!revealedKey || !navigator?.clipboard) return;
    navigator.clipboard
      .writeText(revealedKey)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setError(t("settingsApi.copyFailed")));
  };

  // Close the rename modal on Escape. The new-key reveal modal is deliberately
  // NOT escapable: the key is shown exactly once, so it only closes via Done.
  useEffect(() => {
    if (!renameTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!renameBusy) setRenameTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renameTarget, renameBusy]);

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.api")}
        subtitle={t("settingsApi.noPermission")}
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
        <div role="alert" style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>
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
              <div key={k.id} style={{ display: "grid", gridTemplateColumns: "1fr 2fr 120px 70px", gap: 10, padding: "12px 0", borderBottom: "1px solid rgb(var(--tint) / 0.04)", fontSize: 13, alignItems: "center" }}>
                <span style={{ fontWeight: 500 }}>{k.name}</span>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>
                  {maskKey(k.key)}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {new Date(k.createdAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })}
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
                className={s.input}
                style={{ flex: 1 }}
              />
              <button type="button" className={s.btnPrimary} onClick={onCreate} disabled={creating} style={{ whiteSpace: "nowrap" }}>
                {creating ? t("settingsApi.creating") : t("common.create")}
              </button>
              <button type="button" className={s.btnGhost} onClick={() => { setShowCreate(false); setNewName(""); }}>
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button type="button" className={s.btnSecondary} onClick={() => setShowCreate(true)}>
              {t("settingsApi.createBtn")}
            </button>
          )}
        </div>
      </Card>

      {/* Usage card */}
      <Card title={t("settingsApi.usageTitle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "var(--muted)" }}>
          <span>{t("settingsApi.usageIntroPrefix")} <code style={{ background: "rgb(var(--tint) / 0.04)", padding: "2px 5px", borderRadius: 4 }}>Authorization</code> {t("settingsApi.usageIntroSuffix")}</span>
          <pre className={s.codeBlock} style={{ fontSize: 12, lineHeight: 1.7, padding: "14px 16px", borderRadius: 10 }}>{`curl ${process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000"}/public/v1/posts \\
  -H "Authorization: ps_your_key_here" \\
  -H "Content-Type: application/json"`}</pre>
        </div>
      </Card>

      <ApiRequestGenerator />

      {/* New key modal */}
      {showModal && (
        <div role="dialog" aria-modal="true" aria-label={t("settingsApi.keyCreatedTitle")} style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgb(var(--tint) / 0.45)", backdropFilter: "blur(4px)" }}>
          <div style={{ width: "100%", maxWidth: 480, background: "var(--bg)", borderRadius: 16, padding: "28px 24px 24px", boxShadow: "0 24px 64px rgb(var(--shadow) / calc(0.18 * var(--shadow-boost)))", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>{t("settingsApi.keyCreatedTitle")}</h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                {t("settingsApi.keyCreatedDesc", { name: revealedName })}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "rgb(var(--tint) / 0.03)", borderRadius: 10, border: "1px solid var(--line-soft)" }}>
              <span style={{ flex: 1, fontFamily: "monospace", fontSize: 14, fontWeight: 600, wordBreak: "break-all", lineHeight: 1.5, userSelect: "all" }}>
                {revealedKey}
              </span>
              <button
                type="button"
                className={s.btnGhost}
                onClick={onCopy}
                style={{ whiteSpace: "nowrap", flexShrink: 0 }}
              >
                {copied ? t("settingsApi.copied") : t("settingsApi.copy")}
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" autoFocus className={s.btnPrimary} onClick={() => setShowModal(false)}>
                {t("common.done")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Rename modal */}
      {renameTarget && (
        <div role="dialog" aria-modal="true" aria-label={t("settingsApi.renameTitle")} style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgb(var(--tint) / 0.45)", backdropFilter: "blur(4px)" }} onClick={() => !renameBusy && setRenameTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "var(--bg)", borderRadius: 16, padding: "28px 24px 24px", boxShadow: "0 24px 64px rgb(var(--shadow) / calc(0.18 * var(--shadow-boost)))", display: "flex", flexDirection: "column", gap: 16 }}>
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
              <button type="button" className={s.btnGhost} onClick={() => setRenameTarget(null)} disabled={renameBusy}>
                {t("common.cancel")}
              </button>
              <button type="button" className={s.btnPrimary} onClick={() => void onRename()} disabled={renameBusy || !renameValue.trim()} style={{ opacity: renameValue.trim() ? 1 : 0.5 }}>
                {renameBusy ? t("settingsApi.savingRename") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete confirmation modal */}
      {deleteTarget && (
        <ConfirmDialog
          danger
          title={t("settingsApi.revokeConfirmTitle")}
          body={t("settingsApi.revokeConfirmBody", { name: deleteTarget.name })}
          confirmLabel={t("settingsApi.revokeBtn")}
          onConfirm={() => void onDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
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
      aria-label={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        border: `1px solid ${danger ? "color-mix(in srgb, var(--danger) 38%, transparent)" : "var(--line-soft)"}`,
        background: "var(--bg)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: danger ? "var(--danger-bright)" : "var(--muted)",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}
