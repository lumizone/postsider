"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  UtmPreset,
  getUtmPresets,
  createUtmPreset,
  updateUtmPreset,
  deleteUtmPreset,
} from "@/lib/composer-helpers-api";

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  fontSize: 13,
  background: "var(--bg)",
  color: "var(--fg)",
  width: "100%",
};
const primaryBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 13,
  cursor: "pointer",
};

type Form = {
  name: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
};
const EMPTY: Form = { name: "", utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", utmTerm: "" };

export default function UtmBuilderPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [items, setItems] = useState<UtmPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const refresh = async () => {
    try {
      setItems((await getUtmPresets()) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const openNew = () => {
    setEditing("new");
    setForm(EMPTY);
  };
  const openEdit = (p: UtmPreset) => {
    setEditing(p.id);
    setForm({
      name: p.name,
      utmSource: p.utmSource,
      utmMedium: p.utmMedium,
      utmCampaign: p.utmCampaign,
      utmContent: p.utmContent ?? "",
      utmTerm: p.utmTerm ?? "",
    });
  };

  const save = async () => {
    if (!form.name.trim() || !form.utmSource.trim() || !form.utmMedium.trim() || !form.utmCampaign.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        utmSource: form.utmSource.trim(),
        utmMedium: form.utmMedium.trim(),
        utmCampaign: form.utmCampaign.trim(),
        utmContent: form.utmContent.trim() || null,
        utmTerm: form.utmTerm.trim() || null,
      };
      if (editing === "new") await createUtmPreset(body);
      else if (editing) await updateUtmPreset(editing, body);
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<UtmPreset | null>(null);
  const onDelete = async (id: string) => {
    try {
      await deleteUtmPreset(id);
      setItems((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleteTarget(null);
    }
  };

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.utmBuilder")}
        subtitle="You don't have permission to manage UTM presets."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.utmBuilder")}
        subtitle="Save UTM presets. Applying one in the composer appends tracking params to every URL in your post."
      />
      {error && (
        <div style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>{error}</div>
      )}
      <Card title="">
        {loading ? (
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.length === 0 && editing === null && (
              <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No UTM presets yet.</div>
            )}
            {items.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>source={p.utmSource} · medium={p.utmMedium} · campaign={p.utmCampaign}</div>
                </div>
                <button type="button" style={ghostBtn} onClick={() => openEdit(p)}>Edit</button>
                <button type="button" style={{ ...ghostBtn, color: "#DC2626", borderColor: "rgba(220,38,38,0.25)" }} onClick={() => setDeleteTarget(p)}>Delete</button>
              </div>
            ))}

            {editing !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 0 4px" }}>
                <input style={inputStyle} placeholder="Preset name (e.g. Newsletter June)" value={form.name} onChange={set("name")} autoFocus />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <input style={inputStyle} placeholder="utm_source *" value={form.utmSource} onChange={set("utmSource")} />
                  <input style={inputStyle} placeholder="utm_medium *" value={form.utmMedium} onChange={set("utmMedium")} />
                  <input style={inputStyle} placeholder="utm_campaign *" value={form.utmCampaign} onChange={set("utmCampaign")} />
                  <input style={inputStyle} placeholder="utm_content (optional)" value={form.utmContent} onChange={set("utmContent")} />
                  <input style={inputStyle} placeholder="utm_term (optional)" value={form.utmTerm} onChange={set("utmTerm")} />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" style={primaryBtn} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
                  <button type="button" style={ghostBtn} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            )}

            {editing === null && (
              <div style={{ marginTop: 6 }}>
                <button type="button" style={ghostBtn} onClick={openNew}>+ New preset</button>
              </div>
            )}
          </div>
        )}
      </Card>

      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }} onClick={() => setDeleteTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, background: "var(--bg)", borderRadius: 16, padding: "24px", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>Delete UTM preset?</h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Delete &quot;{deleteTarget.name}&quot;? This cannot be undone.</p>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" style={ghostBtn} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button type="button" style={{ ...primaryBtn, background: "#DC2626", color: "#fff" }} onClick={() => onDelete(deleteTarget.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
