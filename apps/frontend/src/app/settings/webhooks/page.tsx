"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  PageHeader,
  Card,
  settingsStyles as s,
} from "@/components/settings-ui";
import { api } from "@/lib/api";
import { useChannels } from "@/lib/use-channels";
import { useT } from "@/lib/i18n";

interface WebhookIntegration {
  integration: { id: string; name: string; picture: string | null };
}

interface Webhook {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  integrations: WebhookIntegration[];
}

export default function WebhooksSettingsPage() {
  const { channels } = useChannels();
  const t = useT();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null);

  const refresh = async () => {
    try {
      const res = await api.get<Webhook[]>("/webhooks");
      setHooks(res || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsWebhooks.loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.post("/webhooks", {
        name: newName.trim(),
        url: newUrl.trim(),
        integrations: Array.from(selectedChannels).map((id) => ({ id })),
      });
      setShowCreate(false);
      setNewName("");
      setNewUrl("");
      setSelectedChannels(new Set());
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsWebhooks.createError"));
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await api.del(`/webhooks/${id}`);
      setHooks((prev) => prev.filter((h) => h.id !== id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsWebhooks.deleteError"));
      setDeleteTarget(null);
    }
  };

  const toggleChannel = (id: string) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsWebhooks.title")}
        subtitle={t("settingsWebhooks.subtitleFull")}
      />

      {error && (
        <div style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Endpoints list */}
      <Card
        title={t("settingsWebhooks.endpoints")}
        subtitle={loading ? t("common.loading") : t("settingsWebhooks.configured", { count: hooks.length })}
        actions={
          !showCreate ? (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "var(--fg)", color: "var(--bg)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              {t("settingsWebhooks.addEndpoint")}
            </button>
          ) : null
        }
      >
        {loading ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
        ) : hooks.length === 0 && !showCreate ? (
          <div style={{ padding: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ color: "var(--muted)" }}>
              <path d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 14, color: "var(--muted)" }}>{t("settingsWebhooks.noneTitle")}</span>
            <span style={{ fontSize: 12, color: "var(--muted)", maxWidth: 320 }}>
              {t("settingsWebhooks.noneDesc")}
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {hooks.map((h) => (
              <div
                key={h.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 0",
                  borderBottom: "1px solid rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{h.name}</span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "rgba(16,185,129,0.08)", color: "#10B981", fontWeight: 600 }}>
                      {t("settingsWebhooks.active")}
                    </span>
                  </div>
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h.url}
                  </span>
                  {h.integrations.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                      {h.integrations.map((i) => (
                        <span
                          key={i.integration.id}
                          style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "rgba(0,0,0,0.04)", color: "var(--muted)" }}
                        >
                          {i.integration.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(h)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid rgba(220,38,38,0.25)",
                    background: "var(--bg)",
                    color: "#DC2626",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  {t("common.delete")}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <form onSubmit={onCreate} style={{ marginTop: 16, padding: "18px", border: "1px solid var(--line-soft)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("settingsWebhooks.newEndpoint")}</div>
            <div className={s.field}>
              <label className={s.label} htmlFor="hook-name">{t("settingsWebhooks.name")}</label>
              <input
                id="hook-name"
                type="text"
                placeholder={t("settingsWebhooks.namePlaceholder")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className={s.input}
                required
              />
            </div>
            <div className={s.field}>
              <label className={s.label} htmlFor="hook-url">{t("settingsWebhooks.url")}</label>
              <input
                id="hook-url"
                type="url"
                placeholder="https://your-server.com/webhook"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className={s.input}
                required
              />
              <span className={s.hint}>{t("settingsWebhooks.urlHint")}</span>
            </div>

            {channels.length > 0 && (
              <div className={s.field}>
                <span className={s.label}>{t("settingsWebhooks.channelsLabel")}</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {channels.map((ch) => (
                    <label
                      key={ch.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 10px",
                        border: selectedChannels.has(ch.id) ? "1px solid var(--fg)" : "1px solid var(--line-soft)",
                        borderRadius: 8,
                        fontSize: 12,
                        cursor: "pointer",
                        background: selectedChannels.has(ch.id) ? "rgba(0,0,0,0.03)" : "transparent",
                        transition: "border-color 120ms ease",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedChannels.has(ch.id)}
                        onChange={() => toggleChannel(ch.id)}
                        style={{ display: "none" }}
                      />
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ch.color, flexShrink: 0 }} />
                      {ch.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setNewName(""); setNewUrl(""); setSelectedChannels(new Set()); }}
                style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--line-soft)", background: "var(--bg)", fontSize: 13, cursor: "pointer" }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={creating}
                style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--fg)", color: "var(--bg)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                {creating ? t("settingsWebhooks.creating") : t("settingsWebhooks.createEndpoint")}
              </button>
            </div>
          </form>
        )}
      </Card>

      {/* Info */}
      <Card title={t("settingsWebhooks.howItWorks")}>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 10px" }}>
            {t("settingsWebhooks.howItWorks1")}
          </p>
          <p style={{ margin: "0 0 10px" }}>
            {t("settingsWebhooks.howItWorks2")}
          </p>
          <pre className={s.codeBlock} style={{ fontSize: 12, lineHeight: 1.6, padding: "14px 16px", borderRadius: 10 }}>{`{
  "event": "post.published",
  "post": { "id": "...", "content": "...", "publishDate": "..." },
  "integration": { "id": "...", "name": "...", "provider": "..." }
}`}</pre>
        </div>
      </Card>

      {/* Delete modal */}
      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }} onClick={() => setDeleteTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "var(--bg)", borderRadius: 16, padding: "28px 24px 24px", boxShadow: "0 24px 64px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>{t("settingsWebhooks.deleteBtn")}</h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                {t("settingsWebhooks.deleteConfirmPrefix")} <strong>{deleteTarget.name}</strong>{t("settingsWebhooks.deleteConfirmSuffix")}
              </p>
            </div>
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(0,0,0,0.03)", fontFamily: "monospace", fontSize: 12, color: "var(--muted)", wordBreak: "break-all" }}>
              {deleteTarget.url}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setDeleteTarget(null)} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid var(--line-soft)", background: "var(--bg)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                {t("common.cancel")}
              </button>
              <button type="button" onClick={() => void onDelete(deleteTarget.id)} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "#DC2626", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {t("settingsWebhooks.deleteEndpoint")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
