"use client";

import { useState } from "react";
import {
  PageHeader,
  Card,
  settingsStyles as s,
} from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";

type Client = "Claude Code" | "Cursor" | "VS Code" | "Windsurf" | "Amp" | "Codex" | "Gemini CLI" | "Warp";

const CLIENTS: Client[] = ["Claude Code", "Cursor", "VS Code", "Windsurf", "Amp", "Codex", "Gemini CLI", "Warp"];

const TOOLS = [
  { id: "schedulePostTool", name: "Schedule Post", description: "Create and schedule a social media post to one or more channels." },
  { id: "integrationList", name: "List Integrations", description: "List connected channels available for posting." },
  { id: "integrationSchema", name: "Get Integration Schema", description: "Get the required fields and validation rules for a specific channel." },
  { id: "triggerTool", name: "Trigger Integration", description: "Call a provider-specific function (e.g. fetch mentions, boards)." },
  { id: "groupList", name: "List Groups", description: "List customer groups for filtered posting." },
  { id: "uploadFromUrlTool", name: "Upload From URL", description: "Download a remote image/video and add it to the media library." },
  { id: "generateImageTool", name: "Generate Image", description: "Generate an AI image to attach to a post." },
  { id: "generateVideoTool", name: "Generate Video", description: "Generate a video from templates." },
  { id: "generateVideoOptions", name: "Video Options", description: "List available video generation templates and their parameters." },
  { id: "videoFunctionTool", name: "Video Function", description: "Get additional data for video generation (voices, styles, etc)." },
];

export default function McpSettingsPage() {
  const { user } = useAuth();
  const t = useT();
  const [client, setClient] = useState<Client>("Claude Code");
  const [copied, setCopied] = useState(false);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
  const mcpUrl = `${backendUrl}/mcp`;
  const apiKey = user?.publicApi || "<your-api-key>";

  const command = buildCommand(client, mcpUrl, apiKey);

  const onCopy = (text: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.mcp")}
        subtitle={t("settingsMcp.subtitleFull")}
      />

      {/* Connection */}
      <Card title={t("settingsMcp.connectTitle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Client selector */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CLIENTS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setClient(c)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: client === c ? "1.5px solid var(--fg)" : "1px solid var(--line-soft)",
                  background: client === c ? "rgba(0,0,0,0.03)" : "var(--bg)",
                  fontSize: 12,
                  fontWeight: client === c ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 120ms ease",
                }}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Command */}
          <div style={{ position: "relative" }}>
            <pre
              className={s.codeBlock}
              style={{ fontSize: 12, lineHeight: 1.7, padding: "16px 18px", borderRadius: 10, paddingRight: 80 }}
            >
              {command}
            </pre>
            <button
              type="button"
              onClick={() => onCopy(command)}
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                padding: "5px 10px",
                borderRadius: 6,
                border: "1px solid var(--line-soft)",
                background: "var(--bg)",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {copied ? t("settingsApi.copied") : t("settingsApi.copy")}
            </button>
          </div>

          {/* MCP URL */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 8, border: "1px solid var(--line-soft)", background: "rgba(0,0,0,0.015)" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, flexShrink: 0 }}>{t("settingsMcp.mcpUrlLabel")}</span>
            <code style={{ fontSize: 12, flex: 1 }}>{mcpUrl}</code>
            <button
              type="button"
              onClick={() => onCopy(mcpUrl)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--line-soft)", background: "var(--bg)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
            >
              {t("settingsApi.copy")}
            </button>
          </div>

          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            {t("settingsMcp.authNote1")}{" "}
            <strong>{t("settingsMcp.settingsApiPath")}</strong> {t("settingsMcp.authNote2")}
          </p>
        </div>
      </Card>

      {/* Available tools */}
      <Card title={t("settingsMcp.availableTools")} subtitle={t("settingsMcp.toolsExposed", { count: TOOLS.length })}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {TOOLS.map((tool) => (
            <div
              key={tool.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 0",
                borderBottom: "1px solid rgba(0,0,0,0.04)",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  background: "rgba(0,0,0,0.04)",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M9.5 1.5L14.5 6.5L6 15H1V10L9.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{tool.name}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{tool.description}</span>
              </div>
              <code style={{ fontSize: 10, color: "var(--muted)", padding: "3px 6px", borderRadius: 4, background: "rgba(0,0,0,0.03)", whiteSpace: "nowrap", flexShrink: 0 }}>
                {tool.id}
              </code>
            </div>
          ))}
        </div>
      </Card>

      {/* Raw config */}
      <Card title={t("settingsMcp.jsonConfigTitle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            {t("settingsMcp.jsonConfigDesc")}
          </p>
          <div style={{ position: "relative" }}>
            <pre
              className={s.codeBlock}
              style={{ fontSize: 12, lineHeight: 1.6, padding: "16px 18px", borderRadius: 10 }}
            >{`{
  "mcpServers": {
    "postsider": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${apiKey}"
      }
    }
  }
}`}</pre>
            <button
              type="button"
              onClick={() => onCopy(JSON.stringify({ mcpServers: { postsider: { url: mcpUrl, headers: { Authorization: `Bearer ${apiKey}` } } } }, null, 2))}
              style={{ position: "absolute", top: 12, right: 12, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--line-soft)", background: "var(--bg)", fontSize: 11, cursor: "pointer" }}
            >
              {t("settingsApi.copy")}
            </button>
          </div>
        </div>
      </Card>
    </>
  );
}

function buildCommand(client: Client, url: string, token: string): string {
  const auth = `--header "Authorization:Bearer ${token}"`;
  switch (client) {
    case "Claude Code":
      return `claude mcp add --transport http postsider ${url} ${auth}`;
    case "Cursor":
      return `cursor mcp add --transport http postsider ${url} ${auth}`;
    case "VS Code":
      return `# Add to .vscode/mcp.json:\n${JSON.stringify({ servers: { postsider: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)}`;
    case "Windsurf":
      return `windsurf mcp add postsider ${url} ${auth}`;
    case "Amp":
      return `amp mcp add postsider ${url} ${auth}`;
    case "Codex":
      return `codex mcp add --transport http postsider ${url} ${auth}`;
    case "Gemini CLI":
      return `gemini mcp add --http postsider ${url} ${auth}`;
    case "Warp":
      return `warp mcp add postsider ${url} ${auth}`;
  }
}
