"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  getEvergreenSettings,
  saveEvergreenSettings,
  type EvergreenSettings,
} from "@/lib/evergreen-api";

export default function EvergreenSettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [settings, setSettings] = useState<EvergreenSettings>({
    enabled: false,
    intervalDays: 30,
    maxPerRun: 1,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    (async () => {
      try {
        const res = await getEvergreenSettings();
        if (res) setSettings(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [canManage]);

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveEvergreenSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <>
        <PageHeader
          eyebrow={t("settings.eyebrow")}
          title={t("evergreen.title")}
          subtitle={t("evergreen.subtitle")}
        />
        <Card title="">
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            {t("evergreen.noPermission")}
          </div>
        </Card>
      </>
    );
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 6,
    color: "var(--fg)",
  };
  const inputStyle: React.CSSProperties = {
    width: 160,
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid var(--line-soft)",
    fontSize: 13,
    background: "var(--bg)",
    color: "var(--fg)",
  };

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("evergreen.title")}
        subtitle={t("evergreen.subtitle")}
      />

      {error && (
        <div style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>
          {error}
        </div>
      )}

      <Card title="">
        {loading ? (
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            {t("common.loading")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--fg)" }}>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
                style={{ width: 16, height: 16 }}
              />
              {t("evergreen.enable")}
            </label>

            <div>
              <label style={labelStyle} htmlFor="evergreen-interval">
                {t("evergreen.intervalDays")}
              </label>
              <input
                id="evergreen-interval"
                type="number"
                min={1}
                value={settings.intervalDays}
                onChange={(e) => setSettings((s) => ({ ...s, intervalDays: Number(e.target.value) }))}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="evergreen-max">
                {t("evergreen.maxPerRun")}
              </label>
              <input
                id="evergreen-max"
                type="number"
                min={1}
                value={settings.maxPerRun}
                onChange={(e) => setSettings((s) => ({ ...s, maxPerRun: Number(e.target.value) }))}
                style={inputStyle}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--fg)", color: "var(--bg)", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}
              >
                {saving ? t("evergreen.saving") : t("evergreen.save")}
              </button>
              {saved && <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("evergreen.saved")}</span>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
