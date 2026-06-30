"use client";

import { useEffect, useState } from "react";
import {
  PageHeader,
  Card,
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

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  fontSize: 13,
  background: "var(--bg)",
  color: "var(--fg)",
};

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
    if (isPlatformAi) return; // No BYO config needed — platform manages AI.
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
      setMsg(t("postChecker.saved" as any));
    } catch {
      setMsg(t("postChecker.saveError" as any));
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
      setMsg(t("postChecker.saveError" as any));
    }
  };

  const ph = PROVIDERS.find((p) => p.id === provider)?.placeholder;

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow" as any)}
        title={t("postChecker.title" as any)}
        subtitle={t("postChecker.subtitle" as any)}
      />

      {/* Platform manages AI — no BYO config needed. */}
      {isPlatformAi ? (
        <Card title="">
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            AI is managed by the platform on this plan.
          </p>
        </Card>
      ) : !canManage ? (
        <Card title="">
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            {t("postChecker.noPermission" as any)}
          </p>
        </Card>
      ) : (
        <Card title="">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>{t("postChecker.provider" as any)}</label>
              <select
                style={fieldStyle}
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
              <label style={labelStyle}>{t("postChecker.model" as any)}</label>
              <input
                style={fieldStyle}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={ph}
              />
            </div>

            <div>
              <label style={labelStyle}>{t("postChecker.apiKey" as any)}</label>
              <input
                style={fieldStyle}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  configured ? "••••••••" : t("postChecker.apiKeyPlaceholder" as any)
                }
              />
            </div>

            {msg && (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{msg}</p>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={saving || !model || (!apiKey && !configured)}
                onClick={save}
                style={{
                  padding: "9px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--fg)",
                  color: "var(--bg)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    saving || !model || (!apiKey && !configured)
                      ? "default"
                      : "pointer",
                  opacity:
                    saving || !model || (!apiKey && !configured) ? 0.5 : 1,
                }}
              >
                {saving
                  ? t("postChecker.saving" as any)
                  : t("postChecker.save" as any)}
              </button>
              {configured && (
                <button
                  type="button"
                  onClick={remove}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 8,
                    border: "1px solid var(--line-soft)",
                    background: "var(--bg)",
                    color: "var(--fg)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {t("postChecker.disconnect" as any)}
                </button>
              )}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
