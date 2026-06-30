"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  HashtagGroup,
  getHashtagGroups,
  createHashtagGroup,
  updateHashtagGroup,
  deleteHashtagGroup,
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

function parseHashtags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : "#" + h));
}

export default function HashtagGroupsPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [items, setItems] = useState<HashtagGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [platform, setPlatform] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setItems((await getHashtagGroups()) || []);
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
    setName("");
    setTags("");
    setPlatform("");
  };
  const openEdit = (g: HashtagGroup) => {
    setEditing(g.id);
    setName(g.name);
    setTags(g.hashtags.join(" "));
    setPlatform(g.platform ?? "");
  };

  const save = async () => {
    const hashtags = parseHashtags(tags);
    if (!name.trim() || hashtags.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), hashtags, platform: platform.trim() || null };
      if (editing === "new") await createHashtagGroup(body);
      else if (editing) await updateHashtagGroup(editing, body);
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<HashtagGroup | null>(null);
  const onDelete = async (id: string) => {
    try {
      await deleteHashtagGroup(id);
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
        title={t("settings.hashtagGroups")}
        subtitle="You don't have permission to manage hashtag groups."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.hashtagGroups")}
        subtitle="Save named sets of hashtags and insert them into posts with one click."
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
              <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No hashtag groups yet.</div>
            )}
            {items.map((g) => (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {g.name}
                    {g.platform && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>· {g.platform}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.hashtags.join(" ")}</div>
                </div>
                <button type="button" style={ghostBtn} onClick={() => openEdit(g)}>Edit</button>
                <button type="button" style={{ ...ghostBtn, color: "#DC2626", borderColor: "rgba(220,38,38,0.25)" }} onClick={() => setDeleteTarget(g)}>Delete</button>
              </div>
            ))}

            {editing !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 0 4px" }}>
                <input style={inputStyle} placeholder="Group name (e.g. SaaS, Launch)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} placeholder="#saas #marketing #socialmedia" value={tags} onChange={(e) => setTags(e.target.value)} />
                <input style={inputStyle} placeholder="Platform filter (optional, e.g. instagram)" value={platform} onChange={(e) => setPlatform(e.target.value)} />
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" style={primaryBtn} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
                  <button type="button" style={ghostBtn} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            )}

            {editing === null && (
              <div style={{ marginTop: 6 }}>
                <button type="button" style={ghostBtn} onClick={openNew}>+ New group</button>
              </div>
            )}
          </div>
        )}
      </Card>

      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }} onClick={() => setDeleteTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, background: "var(--bg)", borderRadius: 16, padding: "24px", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>Delete hashtag group?</h2>
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
