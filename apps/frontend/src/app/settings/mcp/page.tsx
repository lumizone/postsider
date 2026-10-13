"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, Card, settingsStyles as s } from "@/components/settings-ui";
import { useT } from "@/lib/i18n";
import styles from "./mcp.module.css";

const SELF_HOSTED = process.env.NEXT_PUBLIC_SELF_HOSTED === "true";

/**
 * Public API base (the MCP server's POSTSIDER_API_URL). Self-hosted installs
 * serve it under their own backend URL; only the managed cloud uses
 * api.postsider.com.
 */
const API_URL =
  process.env.NEXT_PUBLIC_PUBLIC_API_URL ||
  (SELF_HOSTED
    ? (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "")
    : "https://api.postsider.com");

/**
 * Remote MCP endpoint. Set NEXT_PUBLIC_MCP_URL at build time to the exact
 * address of your MCP proxy. Without it a self-hosted install shows the
 * conventional mcp.<your-domain> host derived from the backend URL, never the
 * managed cloud address.
 */
function defaultMcpUrl(): string {
  if (!SELF_HOSTED) return "https://mcp.postsider.com/mcp";
  try {
    const u = new URL(process.env.NEXT_PUBLIC_BACKEND_URL || "");
    const host = u.hostname.replace(/^[^.]+\./, "");
    return `${u.protocol}//mcp.${host || u.hostname}/mcp`;
  } catch {
    return "https://mcp.example.com/mcp";
  }
}
const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || defaultMcpUrl();

const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/postsider";

type ClientId =
  | "claude"
  | "chatgpt"
  | "claudecode"
  | "cursor"
  | "vscode"
  | "windsurf"
  | "codex"
  | "any";

const CLIENTS = [
  { id: "claude", name: "Claude", sub: "settingsMcp.sub_claude" },
  { id: "chatgpt", name: "ChatGPT", sub: "settingsMcp.sub_chatgpt" },
  { id: "claudecode", name: "Claude Code", sub: "settingsMcp.sub_claudecode" },
  { id: "cursor", name: "Cursor", sub: "settingsMcp.sub_cursor" },
  { id: "vscode", name: "VS Code", sub: "settingsMcp.sub_vscode" },
  { id: "windsurf", name: "Windsurf", sub: "settingsMcp.sub_windsurf" },
  { id: "codex", name: "Codex", sub: "settingsMcp.sub_codex" },
  { id: "any", name: "", sub: "settingsMcp.genericSub" },
] as const;

const LOGOS: Record<ClientId, string> = {
  claude: "claude",
  chatgpt: "chatgpt",
  claudecode: "claude-code",
  cursor: "cursor",
  vscode: "vscode",
  windsurf: "windsurf",
  codex: "codex",
  any: "mcp",
};

/** Brand mark drawn through a CSS mask so it takes the theme ink colour (light and dark). */
function Brand({ id }: { id: ClientId }) {
  return (
    <span
      className={styles.brand}
      style={{ ["--brand" as string]: `url(/brands/${LOGOS[id]}.svg)` }}
      aria-hidden="true"
    />
  );
}

const STEPS = {
  claude: ["settingsMcp.claude1", "settingsMcp.claude2", "settingsMcp.claude3"],
  chatgpt: ["settingsMcp.chatgpt1", "settingsMcp.chatgpt2", "settingsMcp.chatgpt3", "settingsMcp.chatgpt4"],
  claudecode: ["settingsMcp.claudecode1", "settingsMcp.claudecode2", "settingsMcp.claudecode3"],
  cursor: ["settingsMcp.cursor1", "settingsMcp.cursor2", "settingsMcp.cursor3"],
  vscode: ["settingsMcp.vscode1", "settingsMcp.vscode2", "settingsMcp.vscode3"],
  windsurf: ["settingsMcp.windsurf1", "settingsMcp.windsurf2", "settingsMcp.windsurf3"],
  codex: ["settingsMcp.codex1", "settingsMcp.codex2", "settingsMcp.codex3"],
  any: ["settingsMcp.any1", "settingsMcp.any2", "settingsMcp.any3"],
} as const;

function Snippet({ text, label, wrap }: { text: string; label?: string; wrap?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text stays selectable */
    }
  };
  return (
    <div className={styles.snippet}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.snippetRow}>
        <pre className={`${s.codeBlock} ${styles.snippetCode}${wrap ? " " + styles.snippetWrap : ""}`}>{text}</pre>
        <button type="button" className={s.btnGhost} onClick={onCopy} style={{ whiteSpace: "nowrap" }}>
          {copied ? t("settingsMcp.copied") : t("settingsMcp.copy")}
        </button>
      </div>
    </div>
  );
}

function ClientPanel({ id }: { id: ClientId }) {
  const t = useT();
  const steps = STEPS[id];
  const name = id === "any" ? t("settingsMcp.generic") : CLIENTS.find((c) => c.id === id)?.name;

  const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=postsider&config=${
    typeof btoa === "function" ? btoa(JSON.stringify({ url: MCP_URL })) : ""
  }`;
  const vscodeLink = `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({ name: "postsider", type: "http", url: MCP_URL })
  )}`;

  let extra: React.ReactNode = null;
  if (id === "claude") {
    extra = (
      <div className={styles.actions}>
        <a className={s.btnPrimary} href={CLAUDE_DIRECTORY_URL} target="_blank" rel="noopener noreferrer">
          {t("settingsMcp.addClaude")}
        </a>
      </div>
    );
  } else if (id === "claudecode") {
    extra = <Snippet text={`claude mcp add --transport http postsider ${MCP_URL}`} />;
  } else if (id === "codex") {
    extra = <Snippet text={`codex mcp add postsider --url ${MCP_URL}`} />;
  } else if (id === "cursor") {
    extra = (
      <>
        <div className={styles.actions}>
          <a className={s.btnPrimary} href={cursorLink}>{t("settingsMcp.addCursor")}</a>
        </div>
        <Snippet text={JSON.stringify({ mcpServers: { postsider: { url: MCP_URL } } }, null, 2)} label=".cursor/mcp.json" />
      </>
    );
  } else if (id === "vscode") {
    extra = (
      <>
        <div className={styles.actions}>
          <a className={s.btnPrimary} href={vscodeLink}>{t("settingsMcp.addVscode")}</a>
        </div>
        <Snippet text={JSON.stringify({ servers: { postsider: { type: "http", url: MCP_URL } } }, null, 2)} label=".vscode/mcp.json" />
      </>
    );
  } else if (id === "windsurf") {
    extra = (
      <Snippet
        text={JSON.stringify({ mcpServers: { postsider: { serverUrl: MCP_URL } } }, null, 2)}
        label="mcp_config.json"
      />
    );
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>
        <Brand id={id} />
        {name}
      </h2>
      <ol className={styles.steps}>
        {steps.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>
      {extra}
      {id === "claude" && <p className={styles.note}>{t("settingsMcp.enterprise")}</p>}
      {id !== "any" && <Snippet text={t("settingsMcp.tryPrompt")} label={t("settingsMcp.tryTitle")} wrap />}
    </div>
  );
}

export default function McpSettingsPage() {
  const t = useT();
  const [active, setActive] = useState<ClientId>("claude");
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const localConfig = JSON.stringify(
    {
      mcpServers: {
        postsider: {
          command: "npx",
          args: ["-y", "@postsider/mcp"],
          env: { POSTSIDER_API_KEY: "ps_your_key_here", POSTSIDER_API_URL: API_URL },
        },
      },
    },
    null,
    2
  );

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsMcp.title")}
        subtitle={t("settingsMcp.subtitle")}
      />

      <Card title={t("settingsMcp.endpoint")}>
        <div className={styles.endpointRow}>
          <pre className={`${s.codeBlock} ${styles.endpoint}`}>{MCP_URL}</pre>
          <button type="button" className={s.btnPrimary} onClick={copyUrl}>
            {copied ? t("settingsMcp.copied") : t("settingsMcp.copy")}
          </button>
        </div>

        <div className={styles.panel} style={{ borderTop: "none", paddingTop: 0, marginTop: 16 }}>
          <div className={styles.clients} role="tablist">
            {CLIENTS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={active === c.id}
                className={styles.client + (active === c.id ? " " + styles.clientActive : "")}
                onClick={() => setActive(c.id)}
              >
                <Brand id={c.id} />
                <span className={styles.clientText}>
                  <span className={styles.clientName}>
                    {c.id === "any" ? t("settingsMcp.generic") : c.name}
                  </span>
                  <span className={styles.clientSub}>{t(c.sub)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <ClientPanel id={active} />
      </Card>

      <Card title={t("settingsMcp.localTitle")} subtitle={t("settingsMcp.localDesc")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Snippet text="claude mcp add postsider -e POSTSIDER_API_KEY=ps_your_key_here -- npx -y @postsider/mcp" />
          <Snippet text={localConfig} label="claude_desktop_config.json / .mcp.json" />
          <div>
            <Link href="/settings/api" className={s.btnSecondary}>
              {t("settingsMcp.manageKeys")}
            </Link>
          </div>
        </div>
      </Card>

      <p className={styles.note}>
        <strong>{t("settingsMcp.toolsTitle")}.</strong> {t("settingsMcp.toolsDesc")}
      </p>
    </>
  );
}
