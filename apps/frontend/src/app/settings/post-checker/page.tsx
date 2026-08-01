"use client";

import { useEffect, useState } from "react";
import {
  PageHeader,
  Card,
  settingsStyles as s,
} from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  getCheckerConfig,
  saveCheckerConfig,
  deleteCheckerConfig,
} from "@/lib/post-checker-api";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", placeholder: "e.g. gpt-4.1-mini" },
  { id: "deepseek", label: "DeepSeek", placeholder: "e.g. deepseek-chat" },
  { id: "gemini", label: "Gemini", placeholder: "e.g. gemini-2.5-flash" },
];

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--muted)",
  marginBottom: 6,
};

export default function PostCheckerSettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // When the platform AI key is present, this page is hidden from the nav and
  // should not be reachable, but guard defensively just in case.
  const isPlatformAi = user?.isPlatformAi ?? false;

  useEffect(() => {
    // Platform AI needs no BYO config; non-admins must not fetch it at all
    // (the backend GET is ADMIN-gated now).
    if (isPlatformAi || !canManage) return;
    getCheckerConfig()
      .then((c) => {
        if (c.provider) {
          setProvider(c.provider);
          setModel(c.model ?? "");
          setConfigured(true);
        }
      })
      .catch(() => undefined);
  }, [isPlatformAi]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await saveCheckerConfig({ provider, model, apiKey });
      setConfigured(true);
      setApiKey("");
      setMsg(t("postChecker.saved"));
    } catch {
      setMsg(t("postChecker.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deleteCheckerConfig();
      setConfigured(false);
      setModel("");
      setApiKey("");
      setMsg(null);
    } catch {
      setMsg(t("postChecker.saveError"));
    }
  };

  const ph = PROVIDERS.find((p) => p.id === provider)?.placeholder;

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("postChecker.title")}
        subtitle={t("postChecker.subtitle")}
      />

      {/* Platform manages AI — no BYO config needed. */}
      {isPlatformAi ? (
        <Card title="">
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            {t("postChecker.platformManaged")}
          </p>
        </Card>
      ) : !canManage ? (
        <Card title="">
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            {t("postChecker.noPermission")}
          </p>
        </Card>
      ) : (
        <Card title="">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>{t("postChecker.provider")}</label>
              <select
                className={s.select}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>{t("postChecker.model")}</label>
              <input
                className={s.input}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={ph}
              />
            </div>

            <div>
              <label style={labelStyle}>{t("postChecker.apiKey")}</label>
              <input
                className={s.input}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  configured ? "••••••••" : t("postChecker.apiKeyPlaceholder")
                }
              />
            </div>

            {msg && (
              <p role="status" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{msg}</p>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={s.btnPrimary}
                disabled={saving || !model || (!apiKey && !configured)}
                onClick={save}
                style={{
                  opacity:
                    saving || !model || (!apiKey && !configured) ? 0.5 : 1,
                }}
              >
                {saving ? t("postChecker.saving") : t("postChecker.save")}
              </button>
              {configured && (
                <button type="button" className={s.btnSecondary} onClick={remove}>
                  {t("postChecker.disconnect")}
                </button>
              )}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
