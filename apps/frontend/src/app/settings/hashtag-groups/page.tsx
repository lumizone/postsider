"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, settingsStyles as s } from "@/components/settings-ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  HashtagGroup,
  getHashtagGroups,
  createHashtagGroup,
  updateHashtagGroup,
  deleteHashtagGroup,
} from "@/lib/composer-helpers-api";

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
      const res = await getHashtagGroups();
      setItems(Array.isArray(res) ? res : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settingsHashtagGroups.loadError"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setError(e instanceof Error ? e.message : t("settingsHashtagGroups.saveError"));
    } finally {
      setBusy(false);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<HashtagGroup | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const onDelete = async (id: string) => {
    setDeleteBusy(true);
    try {
      await deleteHashtagGroup(id);
      setItems((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settingsHashtagGroups.deleteError"));
    } finally {
      setDeleteBusy(false);
      setDeleteTarget(null);
    }
  };

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.hashtagGroups")}
        subtitle={t("settingsHashtagGroups.noPermission")}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.hashtagGroups")}
        subtitle={t("settingsHashtagGroups.subtitle")}
      />
      {error && (
        <div role="alert" style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>{error}</div>
      )}
      <Card title="">
        {loading ? (
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.length === 0 && editing === null && (
              <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{t("settingsHashtagGroups.empty")}</div>
            )}
            {items.map((g) => (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid rgb(var(--tint) / 0.05)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {g.name}
                    {g.platform && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>· {g.platform}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.hashtags.join(" ")}</div>
                </div>
                <button type="button" className={s.btnGhost} onClick={() => openEdit(g)}>{t("common.edit")}</button>
                <button type="button" className={s.btnDanger} onClick={() => setDeleteTarget(g)}>{t("common.delete")}</button>
              </div>
            ))}

            {editing !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 0 4px" }}>
                <input className={s.input} placeholder={t("settingsHashtagGroups.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <textarea className={s.textarea} style={{ minHeight: 70 }} placeholder={t("settingsHashtagGroups.hashtagsPlaceholder")} value={tags} onChange={(e) => setTags(e.target.value)} />
                <input className={s.input} placeholder={t("settingsHashtagGroups.platformPlaceholder")} value={platform} onChange={(e) => setPlatform(e.target.value)} />
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className={s.btnPrimary} onClick={save} disabled={busy}>{busy ? t("settingsHashtagGroups.saving") : t("common.save")}</button>
                  <button type="button" className={s.btnGhost} onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                </div>
              </div>
            )}

            {editing === null && (
              <div style={{ marginTop: 6 }}>
                <button type="button" className={s.btnSecondary} onClick={openNew}>{t("settingsHashtagGroups.newGroup")}</button>
              </div>
            )}
          </div>
        )}
      </Card>

      {deleteTarget && (
        <ConfirmDialog
          danger
          busy={deleteBusy}
          title={t("settingsHashtagGroups.deleteTitle")}
          body={t("settingsHashtagGroups.deleteBody", { name: deleteTarget.name })}
          confirmLabel={t("common.delete")}
          onConfirm={() => void onDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
