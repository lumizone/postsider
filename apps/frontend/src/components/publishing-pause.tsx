"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  getPublishingState,
  pausePublishing,
  resumePublishing,
  type PublishingStatePayload,
} from "@/lib/publishing-api";

/**
 * Shared live view of the org's Emergency Pause state. Polls the backend every
 * 30s so a pause triggered from another tab, the public API or a webhook shows
 * up on every dashboard without a reload.
 */
export function usePublishingState() {
  const [state, setState] = useState<PublishingStatePayload | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getPublishingState());
    } catch {
      // The dashboard must never crash because the state endpoint hiccuped.
      // A failed poll just keeps the previous value (null = no banner).
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { state, refresh };
}

/**
 * Owner-only red kill-switch button in the topbar. When paused it becomes a
 * "PAUSED" pill that opens the resume dialog (resume is human-only).
 */
export function PublishingPauseControl({
  state,
  refresh,
}: {
  state: PublishingStatePayload | null;
  refresh: () => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState<"pause" | "resume" | null>(null);
  const [reason, setReason] = useState("");
  const [behavior, setBehavior] = useState<"to_draft" | "auto_resume">(
    "to_draft"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const paused = state?.state === "PAUSED";

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const confirmPause = async () => {
    setBusy(true);
    setError(null);
    try {
      await pausePublishing(reason.trim() || undefined);
      setOpen(null);
      setReason("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("publishing.pauseFailed"));
    } finally {
      setBusy(false);
    }
  };

  const confirmResume = async () => {
    setBusy(true);
    setError(null);
    try {
      await resumePublishing(behavior);
      setOpen(null);
      setBehavior("to_draft");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("publishing.resumeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const commonButton: React.CSSProperties = {
    height: 32,
    padding: "0 12px",
    borderRadius: 999,
    border: "none",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(paused ? "resume" : "pause")}
        title={paused ? t("publishing.resume") : t("publishing.pause")}
        style={{
          ...commonButton,
          background: paused ? "var(--fg)" : "var(--danger-bright)",
          color: paused ? "var(--bg)" : "var(--on-fg)",
        }}
      >
        {paused ? (
          <>
            <span aria-hidden>⏸</span> {t("publishing.paused")}
          </>
        ) : (
          <>
            <span aria-hidden>⏸</span> {t("publishing.pause")}
          </>
        )}
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={
            open === "pause" ? t("publishing.pauseTitle") : t("publishing.resumeTitle")
          }
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
            zIndex: 100,
            display: "grid",
            placeItems: "center",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(null);
          }}
        >
          <div
            style={{
              width: "min(420px, calc(100vw - 32px))",
              background: "var(--bg)",
              border: "1px solid var(--line-soft)",
              borderRadius: "var(--radius-lg)",
              padding: 24,
              boxShadow: "0 16px 48px rgb(var(--shadow) / calc(0.2 * var(--shadow-boost)))",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              {open === "pause"
                ? t("publishing.pauseTitle")
                : t("publishing.resumeTitle")}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              {open === "pause"
                ? t("publishing.pauseHint")
                : t("publishing.resumeHint")}
            </div>

            {open === "pause" ? (
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("publishing.pauseReasonPlaceholder")}
                rows={3}
                style={{
                  width: "100%",
                  marginTop: 14,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--line-soft)",
                  background: "var(--bg)",
                  color: "var(--fg)",
                  fontSize: 13,
                  resize: "vertical",
                }}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 14,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid var(--line-soft)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    checked={behavior === "to_draft"}
                    onChange={() => setBehavior("to_draft")}
                    style={{ marginTop: 2, accentColor: "var(--fg)" }}
                  />
                  <span>
                    <strong style={{ fontSize: 13 }}>
                      {t("publishing.resumeToDraft")}
                    </strong>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: "var(--muted)",
                      }}
                    >
                      {t("publishing.resumeToDraftHint")}
                    </span>
                  </span>
                </label>
                <label
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid var(--line-soft)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    checked={behavior === "auto_resume"}
                    onChange={() => setBehavior("auto_resume")}
                    style={{ marginTop: 2, accentColor: "var(--fg)" }}
                  />
                  <span>
                    <strong style={{ fontSize: 13 }}>
                      {t("publishing.resumeAuto")}
                    </strong>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: "var(--muted)",
                      }}
                    >
                      {t("publishing.resumeAutoHint")}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  color: "var(--danger-bright)",
                  background: "var(--danger-soft)",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setOpen(null)}
                disabled={busy}
                style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 8,
                  border: "1px solid var(--line-soft)",
                  background: "var(--bg)",
                  color: "var(--fg)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={open === "pause" ? confirmPause : confirmResume}
                disabled={busy}
                style={{
                  height: 34,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "none",
                  background:
                    open === "pause"
                      ? "var(--danger-bright)"
                      : "var(--fg)",
                  color: open === "pause" ? "var(--on-fg)" : "var(--bg)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {busy
                  ? t("common.saving")
                  : open === "pause"
                    ? t("publishing.pauseConfirm")
                    : t("publishing.resumeConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Full-width banner shown at the top of every dashboard page while the org is
 * paused — the "whole dashboard is stopped" signal, with the reason.
 */
export function PublishingPauseBanner({
  state,
  refresh,
  canManage,
}: {
  state: PublishingStatePayload | null;
  refresh: () => Promise<void>;
  canManage: boolean;
}) {
  const t = useT();
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state?.state !== "PAUSED") return null;

  const quickResume = async () => {
    setResuming(true);
    setError(null);
    try {
      await resumePublishing("to_draft");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("publishing.resumeFailed"));
    } finally {
      setResuming(false);
    }
  };

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: "var(--radius-md)",
        marginBottom: 24,
        background: "var(--danger-soft)",
        border: "1px solid color-mix(in srgb, var(--danger) 38%, transparent)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          background: "var(--danger-bright)",
          color: "var(--on-fg)",
          flexShrink: 0,
          fontSize: 15,
        }}
      >
        ⏸
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--danger-strong)" }}>
          {t("publishing.pausedBanner")}
          {state.reason ? ` — ${state.reason}` : ""}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {t("publishing.pausedHint")}
        </div>
      </div>
      {canManage && (
        <button
          type="button"
          onClick={() => void quickResume()}
          disabled={resuming}
          style={{
            height: 34,
            padding: "0 16px",
            borderRadius: 999,
            border: "none",
            background: "var(--fg)",
            color: "var(--bg)",
            fontSize: 13,
            fontWeight: 600,
            cursor: resuming ? "default" : "pointer",
            opacity: resuming ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {resuming ? t("common.saving") : t("publishing.resume")}
        </button>
      )}
      {error && (
        <span style={{ fontSize: 12, color: "var(--danger-strong)" }}>{error}</span>
      )}
    </div>
  );
}
