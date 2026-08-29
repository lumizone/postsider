"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, settingsStyles as s } from "@/components/settings-ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  UtmPreset,
  getUtmPresets,
  createUtmPreset,
  updateUtmPreset,
  deleteUtmPreset,
} from "@/lib/composer-helpers-api";

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
      // `|| []` only covers null: a payload that is not an array at all still
      // reached items.map and blanked the page.
      const presets = await getUtmPresets();
      setItems(Array.isArray(presets) ? presets : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settingsUtm.loadError"));
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

  const canSave =
    !!form.name.trim() &&
    !!form.utmSource.trim() &&
    !!form.utmMedium.trim() &&
    !!form.utmCampaign.trim();

  const save = async () => {
    if (!canSave || busy) return;
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
      setError(e instanceof Error ? e.message : t("settingsUtm.saveError"));
    } finally {
      setBusy(false);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<UtmPreset | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const onDelete = async (id: string) => {
    setDeleteBusy(true);
    try {
      await deleteUtmPreset(id);
      setItems((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settingsUtm.deleteError"));
    } finally {
      setDeleteBusy(false);
      setDeleteTarget(null);
    }
  };

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.utmBuilder")}
        subtitle={t("settingsUtm.noPermission")}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.utmBuilder")}
        subtitle={t("settingsUtm.subtitle")}
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
              <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{t("settingsUtm.empty")}</div>
            )}
            {items.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid rgb(var(--tint) / 0.05)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>source={p.utmSource} · medium={p.utmMedium} · campaign={p.utmCampaign}</div>
                </div>
                <button type="button" className={s.btnGhost} onClick={() => openEdit(p)}>{t("common.edit")}</button>
                <button type="button" className={s.btnDanger} onClick={() => setDeleteTarget(p)}>{t("common.delete")}</button>
              </div>
            ))}

            {editing !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 0 4px" }}>
                <input className={s.input} placeholder={t("settingsUtm.namePlaceholder")} value={form.name} onChange={set("name")} autoFocus />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <input className={s.input} placeholder={t("settingsUtm.sourcePlaceholder")} value={form.utmSource} onChange={set("utmSource")} />
                  <input className={s.input} placeholder={t("settingsUtm.mediumPlaceholder")} value={form.utmMedium} onChange={set("utmMedium")} />
                  <input className={s.input} placeholder={t("settingsUtm.campaignPlaceholder")} value={form.utmCampaign} onChange={set("utmCampaign")} />
                  <input className={s.input} placeholder={t("settingsUtm.contentPlaceholder")} value={form.utmContent} onChange={set("utmContent")} />
                  <input className={s.input} placeholder={t("settingsUtm.termPlaceholder")} value={form.utmTerm} onChange={set("utmTerm")} />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className={s.btnPrimary} onClick={save} disabled={busy || !canSave}>{busy ? t("settingsUtm.saving") : t("common.save")}</button>
                  <button type="button" className={s.btnGhost} onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                </div>
              </div>
            )}

            {editing === null && (
              <div style={{ marginTop: 6 }}>
                <button type="button" className={s.btnSecondary} onClick={openNew}>{t("settingsUtm.newPreset")}</button>
              </div>
            )}
          </div>
        )}
      </Card>

      {deleteTarget && (
        <ConfirmDialog
          danger
          busy={deleteBusy}
          title={t("settingsUtm.deleteTitle")}
          body={t("settingsUtm.deleteBody", { name: deleteTarget.name })}
          confirmLabel={t("common.delete")}
          onConfirm={() => void onDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
