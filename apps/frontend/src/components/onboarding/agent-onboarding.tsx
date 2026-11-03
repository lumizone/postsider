"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api";
import { listChannels } from "@/lib/integrations";
import { fetchPostsList } from "@/lib/posts";
import { API_URL, MCP_URL } from "@/lib/developer-endpoints";
import { markOnboardingCompleted } from "@/lib/onboarding-progress";
import { isVerifiedOnboardingDraft } from "@/lib/onboarding-draft-verification";
import styles from "./onboarding.module.css";

type ConnectionMode = "hosted" | "local" | "rest";
type Client = "claude" | "codex" | "cursor";

export function AgentOnboarding({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();
  const [mode, setMode] = useState<ConnectionMode>("hosted");
  const [client, setClient] = useState<Client>("claude");
  const [readConfirmed, setReadConfirmed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [channelCount, setChannelCount] = useState<number | null>(null);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [draftId, setDraftId] = useState("");
  const [verifiedDraftId, setVerifiedDraftId] = useState<string | null>(null);
  const [verifyingDraft, setVerifyingDraft] = useState(false);
  const [draftVerificationFailed, setDraftVerificationFailed] = useState(false);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [keyCount, setKeyCount] = useState<number | null>(null);
  const [channelError, setChannelError] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [checking, setChecking] = useState(true);
  const sequence = useRef(0);
  const verificationSequence = useRef(0);
  const canManage = user?.role === "SUPERADMIN" || user?.role === "ADMIN";

  /**
   * A real server-side readback: the dashboard API is authenticated with the
   * current session cookie, not an organization key pasted into the browser.
   * Never claim this proves MCP OAuth completed — its session is opaque to us.
   */
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    // An updated channel list invalidates any previously verified draft.
    verificationSequence.current += 1;
    setVerifiedDraftId(null);
    setVerifyingDraft(false);
    setChecking(true);
    const results = await Promise.allSettled([
      listChannels(),
      fetchPostsList({ page: 0, limit: 1, state: "draft" }),
      canManage
        ? api.get<unknown>("/settings/api-keys", undefined, { silent: true })
        : Promise.resolve(null),
    ]);
    if (current !== sequence.current) return;
    const [channelResult, draftResult, keyResult] = results;

    if (channelResult.status === "fulfilled" && Array.isArray(channelResult.value.channels)) {
      setChannelCount(channelResult.value.channels.length);
      setChannelIds(channelResult.value.raw.map((integration) => integration.id));
      setChannelError(false);
    } else {
      setChannelCount(null);
      setChannelIds([]);
      setChannelError(true);
    }

    if (draftResult.status === "fulfilled" &&
        typeof draftResult.value.total === "number") {
      setDraftCount(draftResult.value.total);
      setDraftError(false);
    } else {
      setDraftCount(null);
      setDraftError(true);
    }

    if (canManage) {
      if (keyResult.status === "fulfilled" && Array.isArray(keyResult.value)) {
        setKeyCount(keyResult.value.length);
        setKeyError(false);
      } else {
        setKeyCount(null);
        setKeyError(true);
      }
    } else {
      setKeyCount(null);
      setKeyError(false);
    }
    setChecking(false);
  }, [canManage]);

  useEffect(() => {
    void refresh();
    return () => {
      sequence.current += 1;
      verificationSequence.current += 1;
    };
  }, [refresh]);

  const hostedCode =
    client === "claude"
      ? "claude mcp add --transport http postsider " + MCP_URL
      : client === "codex"
        ? "codex mcp add postsider --url " + MCP_URL
        : JSON.stringify({ mcpServers: { postsider: { url: MCP_URL } } }, null, 2);

  const localCode = JSON.stringify(
    {
      mcpServers: {
        postsider: {
          command: "npx",
          args: ["-y", "@postsider/mcp"],
          env: {
            POSTSIDER_API_KEY: "YOUR_API_KEY",
            POSTSIDER_API_URL: API_URL,
          },
        },
      },
    },
    null,
    2,
  );

  const restCode = [
    "# Configure POSTSIDER_API_KEY as a private server-side environment variable.",
    "# PostSider API keys use the raw Authorization value, not Bearer.",
    "curl --fail-with-body --silent --show-error " + "\\",
    "  -H \"Authorization: $POSTSIDER_API_KEY\" " + "\\",
    "  " + API_URL.replace(/\/+$/, "") + "/public/v1/integrations",
  ].join("\n");
  const code = mode === "hosted" ? hostedCode : mode === "local" ? localCode : restCode;

  const copy = async (kind: string, value: string) => {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopyError(true);
    }
  };

  const verifyDraftId = async () => {
    const checkId = ++verificationSequence.current;
    const id = draftId.trim();
    setVerifiedDraftId(null);
    setDraftVerificationFailed(false);
    if (!/^[a-zA-Z0-9_-]{6,128}$/.test(id) || channelIds.length === 0) {
      setDraftVerificationFailed(true);
      return;
    }
    setVerifyingDraft(true);
    try {
      // GET /posts/:id is already used by the dashboard. It is scoped by the
      // authenticated organization and includes each stored post's state.
      const result = await api.get<unknown>(
        "/posts/" + encodeURIComponent(id), undefined, { silent: true }
      );
      if (checkId !== verificationSequence.current) return;
      const verified = isVerifiedOnboardingDraft(result, id, channelIds);
      if (verified) setVerifiedDraftId(id);
      else setDraftVerificationFailed(true);
    } catch {
      if (checkId === verificationSequence.current) setDraftVerificationFailed(true);
    } finally {
      if (checkId === verificationSequence.current) setVerifyingDraft(false);
    }
  };

  const complete = () => {
    // Proof is the user-confirmed read-only client check PLUS a specific,
    // server-read draft ID belonging to this organization's active channels.
    // It does not claim the application can attribute the draft to an MCP client.
    if (!readConfirmed || !channelCount || !verifiedDraftId || checking || verifyingDraft) return;
    markOnboardingCompleted(user?.id, user?.orgId);
    router.replace("/calendar");
  };

  const canFinish = readConfirmed && !!channelCount && !!verifiedDraftId &&
    !checking && !verifyingDraft;

  return (
    <div className={styles.agentFlow}>
      <div className={styles.agentHeader}>
        <div>
          <p className={styles.eyebrow}>{t("developerOnboarding.agentKicker")}</p>
          <h1 className={styles.choiceTitle}>{t("developerOnboarding.agentTitle")}</h1>
          <p className={styles.choiceSubtitle}>{t("developerOnboarding.agentSubtitle")}</p>
        </div>
        <button className={styles.backButton} type="button" onClick={onBack}>
          {t("developerOnboarding.agentBack")}
        </button>
      </div>

      <section className={styles.agentSection} aria-labelledby="first-channel">
        <span className={styles.sectionNumber} aria-hidden="true">01</span>
        <div className={styles.sectionBody}>
          <h2 className={styles.sectionTitle} id="first-channel">
            {t("developerOnboarding.agentChannelTitle")}
          </h2>
          <p className={styles.sectionText}>{t("developerOnboarding.agentChannelDescription")}</p>
          <div className={styles.statusRow} role="status" aria-live="polite">
            <span className={styles.statusDot} aria-hidden="true" />
            <span>
              {checking && channelCount === null
                ? t("developerOnboarding.agentRefreshing")
                : channelError
                  ? t("developerOnboarding.agentChannelsFailure")
                  : channelCount !== null && channelCount > 0
                    ? t("developerOnboarding.agentChannelsFound", { count: channelCount })
                    : t("developerOnboarding.agentChannelsNone")}
            </span>
          </div>
          {canManage ? (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => router.replace("/calendar?connect=1")}
            >
              {t("developerOnboarding.agentConnectAction")} <span aria-hidden="true">↗</span>
            </button>
          ) : (
            <p className={styles.note}>{t("developerOnboarding.agentConnectMember")}</p>
          )}
        </div>
      </section>

      <section className={styles.agentSection} aria-labelledby="agent-connection">
        <span className={styles.sectionNumber} aria-hidden="true">02</span>
        <div className={styles.sectionBody}>
          <h2 className={styles.sectionTitle} id="agent-connection">
            {t("developerOnboarding.agentConfigTitle")}
          </h2>
          <p className={styles.sectionText}>{t("developerOnboarding.agentConfigDescription")}</p>
          <div className={styles.switcher} aria-label={t("developerOnboarding.agentConfigTitle")}>
            {(["hosted", "local", "rest"] as const).map((item) => (
              <button
                key={item}
                className={styles.switchButton + (mode === item ? " " + styles.switchButtonActive : "")}
                type="button"
                aria-pressed={mode === item}
                onClick={() => { setMode(item); setCopied(null); setCopyError(false); }}
              >
                {item === "hosted" ? t("developerOnboarding.agentModeHosted")
                  : item === "local" ? t("developerOnboarding.agentModeLocal")
                    : t("developerOnboarding.agentModeRest")}
              </button>
            ))}
          </div>
          {mode === "hosted" && (
            <div className={styles.clientSwitcher} aria-label="MCP client">
              {(["claude", "codex", "cursor"] as const).map((item) => (
                <button
                  type="button"
                  key={item}
                  aria-pressed={client === item}
                  className={client === item ? styles.clientActive : ""}
                  onClick={() => { setClient(item); setCopied(null); }}
                >
                  {item === "claude" ? t("developerOnboarding.agentClientClaude")
                    : item === "codex" ? t("developerOnboarding.agentClientCodex")
                      : t("developerOnboarding.agentClientCursor")}
                </button>
              ))}
            </div>
          )}
          <p className={styles.sectionText}>
            {mode === "hosted" ? t("developerOnboarding.agentHostedInfo")
              : mode === "local" ? t("developerOnboarding.agentLocalInfo")
                : t("developerOnboarding.agentRestInfo")}
          </p>
          <div className={styles.codeBlock}>
            <div className={styles.codeHeader}>
              <span>{t("developerOnboarding.agentCodeLabel")}</span>
              <button type="button" onClick={() => void copy("config", code)}>
                {copied === "config"
                  ? t("developerOnboarding.agentCopied")
                  : t("developerOnboarding.agentCopy")}
              </button>
            </div>
            <pre><code>{code}</code></pre>
          </div>
          {copyError && (
            <p className={styles.note} role="alert">{t("developerOnboarding.agentCopyError")}</p>
          )}
          <div className={styles.resourceLinks}>
            <Link href="/settings/mcp" target="_blank" rel="noopener noreferrer">
              {t("developerOnboarding.agentMcpSettings")} <span aria-hidden="true">↗</span>
            </Link>
            {mode !== "hosted" && (
              <>
                <Link href="/settings/api" target="_blank" rel="noopener noreferrer">
                  {t("developerOnboarding.agentApiSettings")} <span aria-hidden="true">↗</span>
                </Link>
                <span className={styles.note}>
                  {!canManage ? t("developerOnboarding.agentKeyNoPermission")
                    : keyError ? t("developerOnboarding.agentKeyUnavailable")
                      : keyCount === null ? t("developerOnboarding.agentRefreshing")
                        : t("developerOnboarding.agentKeyCount", { count: keyCount })}
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      <section className={styles.agentSection} aria-labelledby="agent-read-test">
        <span className={styles.sectionNumber} aria-hidden="true">03</span>
        <div className={styles.sectionBody}>
          <h2 className={styles.sectionTitle} id="agent-read-test">
            {t("developerOnboarding.agentReadTitle")}
          </h2>
          <p className={styles.sectionText}>{t("developerOnboarding.agentReadDescription")}</p>
          <div className={styles.codeBlock}>
            <div className={styles.codeHeader}>
              <span>{t("developerOnboarding.agentReadTitle")}</span>
              <button type="button"
                onClick={() => void copy("read", t("developerOnboarding.agentReadPrompt"))}>
                {copied === "read"
                  ? t("developerOnboarding.agentCopied")
                  : t("developerOnboarding.agentCopy")}
              </button>
            </div>
            <pre className={styles.prompt}>
              <code>{t("developerOnboarding.agentReadPrompt")}</code>
            </pre>
          </div>
          <label className={styles.confirmCheck}>
            <input
              type="checkbox"
              checked={readConfirmed}
              onChange={(event) => setReadConfirmed(event.target.checked)}
            />
            <span>{t("developerOnboarding.agentReadConfirmed")}</span>
          </label>
          <p className={styles.note}>{t("developerOnboarding.agentReadWarning")}</p>
        </div>
      </section>

      <section className={styles.agentSection} aria-labelledby="agent-draft-test">
        <span className={styles.sectionNumber} aria-hidden="true">04</span>
        <div className={styles.sectionBody}>
          <h2 className={styles.sectionTitle} id="agent-draft-test">
            {t("developerOnboarding.agentDraftTitle")}
          </h2>
          <p className={styles.sectionText}>{t("developerOnboarding.agentDraftDescription")}</p>
          <div className={styles.codeBlock}>
            <div className={styles.codeHeader}>
              <span>{t("developerOnboarding.agentDraftTitle")}</span>
              <button type="button"
                onClick={() => void copy("draft", t("developerOnboarding.agentDraftPrompt"))}>
                {copied === "draft"
                  ? t("developerOnboarding.agentCopied")
                  : t("developerOnboarding.agentCopy")}
              </button>
            </div>
            <pre className={styles.prompt}>
              <code>{t("developerOnboarding.agentDraftPrompt")}</code>
            </pre>
          </div>
          <div className={styles.draftEvidence}>
            <span role="status" aria-live="polite">
              {checking && draftCount === null
                ? t("developerOnboarding.agentRefreshing")
                : draftError
                  ? t("developerOnboarding.agentDraftError")
                  : draftCount !== null && draftCount > 0
                    ? t("developerOnboarding.agentDraftFound", { count: draftCount })
                    : t("developerOnboarding.agentDraftNone")}
            </span>
            <button type="button" disabled={checking} onClick={() => void refresh()}>
              {checking
                ? t("developerOnboarding.agentRefreshing")
                : t("developerOnboarding.agentRefresh")}
            </button>
          </div>
          <div className={styles.verifyDraft}>
            <label htmlFor="onboarding-draft-id">
              {t("developerOnboarding.agentDraftIdLabel")}
            </label>
            <div className={styles.verifyDraftRow}>
              <input
                id="onboarding-draft-id"
                type="text"
                value={draftId}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("developerOnboarding.agentDraftIdPlaceholder")}
                onChange={(event) => {
                  // Ignore a late response for the previous ID.
                  verificationSequence.current += 1;
                  setVerifyingDraft(false);
                  setDraftId(event.target.value);
                  setVerifiedDraftId(null);
                  setDraftVerificationFailed(false);
                }}
              />
              <button type="button" disabled={verifyingDraft || !draftId.trim()}
                onClick={() => void verifyDraftId()}>
                {verifyingDraft
                  ? t("developerOnboarding.agentVerifyingDraft")
                  : t("developerOnboarding.agentVerifyDraft")}
              </button>
            </div>
            <p className={styles.note} role="status" aria-live="polite">
              {verifiedDraftId
                ? t("developerOnboarding.agentVerifiedDraft")
                : draftVerificationFailed
                  ? t("developerOnboarding.agentVerifyFailed")
                  : t("developerOnboarding.agentVerifyHelp")}
            </p>
          </div>
          <p className={styles.note}>{t("developerOnboarding.agentDraftWarning")}</p>
          <Link className={styles.secondaryTextLink} href="/posts"
            target="_blank" rel="noopener noreferrer">
            {t("developerOnboarding.agentDraftOpen")} <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <div className={styles.agentFinish}>
        <button type="button" className={styles.primaryButton}
          disabled={!canFinish} onClick={complete}>
          {t("developerOnboarding.agentFinish")}
        </button>
        {!canFinish && (
          <p className={styles.note}>{t("developerOnboarding.agentFinishHint")}</p>
        )}
        <div className={styles.agentFooterLinks}>
          <button type="button" onClick={() => router.replace("/calendar")}>
            {t("developerOnboarding.agentContinue")}
          </button>
          <a href="https://postsider.com/developers/"
            target="_blank" rel="noopener noreferrer">
            {t("developerOnboarding.agentDocs")} <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}
