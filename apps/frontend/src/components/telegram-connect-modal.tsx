"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./custom-fields-modal.module.css";
import { useT } from "@/lib/i18n";
import { connectIntegration, pollTelegramUpdates } from "@/lib/integrations";

// The shared platform bot users add to their channel/group.
const BOT_USERNAME = "postsider_news_bot";

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Short, unambiguous code (no 0/O/1/I) shown as `/connect <code>`.
function makeCode(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i += 1) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

interface TelegramConnectModalProps {
  /** OAuth state issued by getOauthUrl('telegram') — needed to finalize. */
  state: string;
  onClose: () => void;
  onConnected: () => void;
}

export function TelegramConnectModal({
  state,
  onClose,
  onConnected,
}: TelegramConnectModalProps) {
  const t = useT();
  const [code] = useState(makeCode);
  const [phase, setPhase] = useState<"waiting" | "connecting" | "error">(
    "waiting",
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Keep the latest onConnected without making it an effect dependency, so the
  // polling loop starts exactly once per modal open (not on every parent render).
  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  const command = `/connect ${code}`;

  // Poll the bot until the user posts `/connect <code>` in a chat where the
  // bot is admin, then finalize the connection. `cancelled` is a per-run local
  // (not a shared ref) so a re-run can never resurrect a previous loop.
  useEffect(() => {
    let cancelled = false;
    let offset: number | undefined;

    const run = async () => {
      while (!cancelled) {
        try {
          const res = await pollTelegramUpdates(code, offset);
          if (cancelled) return;

          if (res?.chatId) {
            setPhase("connecting");
            const result = await connectIntegration("telegram", {
              code: btoa(JSON.stringify({ chatId: res.chatId })),
              state,
            });
            if (cancelled) return;
            if (result?.error) {
              setError(result.error);
              setPhase("error");
              return;
            }
            onConnectedRef.current();
            return;
          }

          if (res?.lastChatId) offset = res.lastChatId;
        } catch {
          // Transient error — keep polling.
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [code, state]);

  // Esc to close + lock background scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — user can select the text manually.
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Connect Telegram"
      onClick={onClose}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <span className={styles.eyebrow}>{t("channels.connect")}</span>
            <span className={styles.title}>Telegram</span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.form}>
          <div className={styles.field}>
            <span className={styles.label}>
              1. Add{" "}
              <strong>@{BOT_USERNAME}</strong> as an administrator to your
              Telegram channel or group.
            </span>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>
              2. Send this command in that chat:
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className={styles.input}
                value={command}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                style={{ fontFamily: "monospace", flex: 1 }}
              />
              <button
                type="button"
                className={styles.submitBtn}
                onClick={copy}
                style={{ width: "auto", whiteSpace: "nowrap" }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {phase === "waiting" && (
            <div className={styles.label} style={{ opacity: 0.8 }}>
              ⏳ Waiting for the command… the channel is detected automatically.
            </div>
          )}
          {phase === "connecting" && (
            <div className={styles.label}>✓ Detected — connecting…</div>
          )}
          {phase === "error" && error && (
            <div className={styles.formError}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
