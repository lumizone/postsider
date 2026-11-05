"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import {
  decideApproverLink,
  getApproverLink,
  type ApproverLinkView as LinkData,
} from "@/lib/approver-link-api";
import {
  canSubmit,
  errorKind,
  intentFromQuery,
  shouldRetryAfterRefresh,
  stageLabel,
  type ApproverErrorKind,
  type Intent,
} from "@/lib/approver-link-model";
import { PlatformIcon } from "./platform-icon";

// Backend refuses a decision sooner than 2 s after the page data was issued.
const UNLOCK_MS = 2500;

const filledBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "1px solid var(--fg)",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 14,
  cursor: "pointer",
};
const disabledStyle: React.CSSProperties = { opacity: 0.5, cursor: "not-allowed" };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Outcome = "approved" | "rejected" | "advanced";

function statusOf(e: unknown): { status: number; body: unknown } {
  if (e instanceof ApiError) return { status: e.status, body: e.body };
  return { status: 0, body: null };
}

const ERROR_KEY = {
  invalid: "approverLink.errInvalid",
  not_allowed: "approverLink.errNotAllowed",
  self: "approverLink.selfBlocked",
  resolved: "approverLink.errResolved",
  rate_limited: "approverLink.errRate",
  network: "approverLink.errNetwork",
} as const;

export function ApproverLinkView({ token }: { token: string }) {
  const t = useT();
  const [data, setData] = useState<LinkData | null>(null);
  const [loading, setLoading] = useState(true);
  // Terminal failure: replaces the whole card. The message is deliberately
  // identical for every kind of dead link.
  const [fatal, setFatal] = useState<ApproverErrorKind | null>(null);
  // Recoverable failure (network, rate limit): shown above the buttons.
  const [inlineError, setInlineError] = useState<ApproverErrorKind | null>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const refreshed = useRef(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armUnlock = useCallback(() => {
    setReady(false);
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => setReady(true), UNLOCK_MS);
  }, []);

  useEffect(() => {
    setIntent(intentFromQuery(window.location.search));
    let cancelled = false;
    getApproverLink(token)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        armUnlock();
      })
      .catch((e) => {
        if (cancelled) return;
        const { status, body } = statusOf(e);
        setFatal(errorKind(status, body));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    };
  }, [token, armUnlock]);

  const submit = async (decision: Intent) => {
    if (!data) return;
    if (!canSubmit({ ready, submitting, selfApprovalBlocked: data.selfApprovalBlocked, done: outcome !== null })) {
      return;
    }
    setSubmitting(true);
    setInlineError(null);
    const body = (challenge: string) => ({
      decision,
      note: decision === "reject" && note.trim() ? note.trim() : undefined,
      challenge,
    });
    try {
      let result;
      try {
        result = await decideApproverLink(token, body(data.challenge));
      } catch (first) {
        const { status, body: errBody } = statusOf(first);
        const kind = errorKind(status, errBody);
        if (!shouldRetryAfterRefresh(kind, refreshed.current)) throw first;
        // The page may have been open longer than the challenge lives: fetch
        // a fresh one once, wait out the minimum delay, then retry once.
        refreshed.current = true;
        const fresh = await getApproverLink(token);
        setData(fresh);
        await sleep(UNLOCK_MS);
        result = await decideApproverLink(token, body(fresh.challenge));
      }
      setOutcome(
        decision === "reject" ? "rejected" : result.final ? "approved" : "advanced",
      );
    } catch (e) {
      const { status, body: errBody } = statusOf(e);
      const kind = errorKind(status, errBody);
      if (kind === "network" || kind === "rate_limited") setInlineError(kind);
      else setFatal(kind);
    } finally {
      setSubmitting(false);
    }
  };

  const active = (btn: Intent): React.CSSProperties => {
    const filled = (intent ?? "approve") === btn;
    return filled ? filledBtn : ghostBtn;
  };
  const blocked = !data
    ? true
    : !canSubmit({ ready, submitting, selfApprovalBlocked: data.selfApprovalBlocked, done: outcome !== null });

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
          PostSider
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0" }}>{t("approverLink.title")}</h1>
      </div>

      {loading ? (
        <div role="status" style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
          {t("approverLink.loading")}
        </div>
      ) : outcome ? (
        <div role="status" style={{ padding: "40px 0", textAlign: "center", fontSize: 16, fontWeight: 600 }}>
          {outcome === "approved"
            ? t("approverLink.doneApproved")
            : outcome === "rejected"
              ? t("approverLink.doneRejected")
              : t("approverLink.doneAdvanced")}
        </div>
      ) : fatal || !data ? (
        <div role="alert" style={{ padding: 16, borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 14 }}>
          {t(ERROR_KEY[fatal ?? "invalid"])}
        </div>
      ) : (
        <div style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
            {data.channel.providerIdentifier && (
              <PlatformIcon platform={data.channel.providerIdentifier} size={20} />
            )}
            <span style={{ wordBreak: "break-word" }}>
              {data.channel.name || t("approverLink.channelFallback")}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>
            {data.requester.name && (
              <span>{t("approverLink.requestedBy", { name: data.requester.name })}</span>
            )}
            <span>{stageLabel(data.stage, t)}</span>
            {data.post.publishDate && <span>{new Date(data.post.publishDate).toLocaleString()}</span>}
          </div>

          {data.post.media.some((m) => m.type === "image") && (
            <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
              {data.post.media
                .filter((m) => m.type === "image")
                .map((m, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={m.path}
                    alt=""
                    referrerPolicy="no-referrer"
                    style={{ width: 120, height: 120, borderRadius: 8, objectFit: "cover", border: "1px solid var(--line-soft)", flex: "0 0 auto" }}
                  />
                ))}
            </div>
          )}
          {data.post.media.some((m) => m.type === "video") && (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("approverLink.videoAttached")}</div>
          )}

          <div style={{ fontSize: 15, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {data.post.text || t("approverLink.noText")}
          </div>

          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {t("approverLink.decidingAs", { name: data.approver.name })}
          </div>

          {data.selfApprovalBlocked && (
            <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>
              {t("approverLink.selfBlocked")}
            </div>
          )}
          {inlineError && (
            <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>
              {t(ERROR_KEY[inlineError])}
            </div>
          )}

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("approverLink.notePlaceholder")}
            aria-label={t("approverLink.noteLabel")}
            maxLength={500}
            rows={3}
            disabled={data.selfApprovalBlocked}
            style={{ borderRadius: 8, border: "1px solid var(--line-soft)", background: "var(--bg)", color: "var(--fg)", padding: 10, fontSize: 14, width: "100%", boxSizing: "border-box", resize: "vertical" }}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              style={{ ...active("approve"), ...(blocked ? disabledStyle : null) }}
              disabled={blocked}
              aria-busy={submitting || undefined}
              onClick={() => submit("approve")}
            >
              {t("approverLink.approve")}
            </button>
            <button
              type="button"
              style={{ ...active("reject"), ...(blocked ? disabledStyle : null) }}
              disabled={blocked}
              aria-busy={submitting || undefined}
              onClick={() => submit("reject")}
            >
              {t("approverLink.reject")}
            </button>
          </div>
          {!ready && !data.selfApprovalBlocked && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("approverLink.waiting")}</div>
          )}
        </div>
      )}
    </main>
  );
}
