"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, settingsStyles as s } from "@/components/settings-ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  CaptionTemplate,
  getCaptionTemplates,
  createCaptionTemplate,
  updateCaptionTemplate,
  deleteCaptionTemplate,
} from "@/lib/composer-helpers-api";

export default function CaptionTemplatesPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [items, setItems] = useState<CaptionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setItems((await getCaptionTemplates()) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settingsCaptionTemplates.loadError"));
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
    setContent("");
  };
  const openEdit = (c: CaptionTemplate) => {
    setEditing(c.id);
    setName(c.name);
    setContent(c.content);
  };

  const save = async () => {
    if (!name.trim() || !content.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), content };
      if (editing === "new") await createCaptionTemplate(body);
      else if (editing) await updateCaptionTemplate(editing, body);
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settingsCaptionTemplates.saveError"));
    } finally {
      setBusy(false);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<CaptionTemplate | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const onDelete = async (id: string) => {
    setDeleteBusy(true);
    try {
      await deleteCaptionTemplate(id);
      setItems((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settingsCaptionTemplates.deleteError"));
    } finally {
      setDeleteBusy(false);
      setDeleteTarget(null);
    }
  };

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.captionTemplates")}
        subtitle={t("settingsCaptionTemplates.noPermission")}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.captionTemplates")}
        subtitle={t("settingsCaptionTemplates.subtitle")}
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
              <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{t("settingsCaptionTemplates.empty")}</div>
            )}
            {items.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid rgb(var(--tint) / 0.05)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.content}</div>
                </div>
                <button type="button" className={s.btnGhost} onClick={() => openEdit(c)}>{t("common.edit")}</button>
                <button type="button" className={s.btnDanger} onClick={() => setDeleteTarget(c)}>{t("common.delete")}</button>
              </div>
            ))}

            {editing !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 0 4px" }}>
                <input className={s.input} placeholder={t("settingsCaptionTemplates.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <textarea className={s.textarea} style={{ minHeight: 100 }} placeholder={t("settingsCaptionTemplates.contentPlaceholder")} value={content} onChange={(e) => setContent(e.target.value)} />
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className={s.btnPrimary} onClick={save} disabled={busy}>{busy ? t("settingsCaptionTemplates.saving") : t("common.save")}</button>
                  <button type="button" className={s.btnGhost} onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                </div>
              </div>
            )}

            {editing === null && (
              <div style={{ marginTop: 6 }}>
                <button type="button" className={s.btnSecondary} onClick={openNew}>{t("settingsCaptionTemplates.newTemplate")}</button>
              </div>
            )}
          </div>
        )}
      </Card>

      {deleteTarget && (
        <ConfirmDialog
          danger
          busy={deleteBusy}
          title={t("settingsCaptionTemplates.deleteTitle")}
          body={t("settingsCaptionTemplates.deleteBody", { name: deleteTarget.name })}
          confirmLabel={t("common.delete")}
          onConfirm={() => void onDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
