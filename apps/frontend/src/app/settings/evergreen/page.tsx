"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, settingsStyles as ui } from "@/components/settings-ui";
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

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("evergreen.title")}
        subtitle={t("evergreen.subtitle")}
      />

      {error && (
        <div role="alert" style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>
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
                // min={1} is only a hint — cleared/typed input bypasses it
                // (Number("") === 0). Clamp so 0/negative never reaches the API.
                onChange={(e) => setSettings((s) => ({ ...s, intervalDays: Math.max(1, Number(e.target.value) || 1) }))}
                className={ui.input}
                style={{ width: 160 }}
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
                onChange={(e) => setSettings((s) => ({ ...s, maxPerRun: Math.max(1, Number(e.target.value) || 1) }))}
                className={ui.input}
                style={{ width: 160 }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                className={ui.btnPrimary}
                onClick={onSave}
                disabled={saving}
                style={{ opacity: saving ? 0.6 : 1 }}
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
