"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./custom-fields-modal.module.css";
import { useT } from "@/lib/i18n";
import { connectIntegration } from "@/lib/integrations";

// Official Sign In With Neynar (SIWN) widget script. It scans the page for
// `.neynar_signin` divs, renders a "Sign in with Neynar" button, opens the
// auth popup, and calls the named global success callback with the signer.
const SIWN_SCRIPT = "https://neynarxyz.github.io/siwn/raw/1.2.0/index.js";
const CALLBACK = "__postsiderNeynarSignin";

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

interface FarcasterConnectModalProps {
  /** Sign In With Neynar client id (from the backend). */
  clientId: string;
  /** OAuth state issued by getOauthUrl('wrapcast') — needed to finalize. */
  state: string;
  onClose: () => void;
  onConnected: () => void;
}

export function FarcasterConnectModal({
  clientId,
  state,
  onClose,
  onConnected,
}: FarcasterConnectModalProps) {
  const t = useT();
  const [phase, setPhase] = useState<"idle" | "connecting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  // Wire the SIWN global success callback and (re)load the widget script so it
  // renders the button into our div and drives the popup login.
  useEffect(() => {
    let done = false;

    (window as unknown as Record<string, unknown>)[CALLBACK] = async (data: {
      signer_uuid?: string;
      fid?: number | string;
      user?: { username?: string; display_name?: string; pfp_url?: string };
    }) => {
      if (done) return;
      if (!data?.signer_uuid || !data?.fid) {
        setError("Sign-in did not return a signer. Please try again.");
        setPhase("error");
        return;
      }
      setPhase("connecting");
      // Backend authenticate() reads these exact (flat, snake_case) fields.
      const payload = {
        signer_uuid: data.signer_uuid,
        fid: data.fid,
        display_name: data.user?.display_name ?? data.user?.username ?? "",
        username: data.user?.username ?? "",
        pfp_url: data.user?.pfp_url ?? "",
      };
      try {
        const result = await connectIntegration("wrapcast", {
          code: btoa(JSON.stringify(payload)),
          state,
        });
        if (result?.error) {
          setError(result.error);
          setPhase("error");
          return;
        }
        done = true;
        onConnectedRef.current();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Connection failed.");
        setPhase("error");
      }
    };

    const script = document.createElement("script");
    script.src = SIWN_SCRIPT;
    script.async = true;
    document.body.appendChild(script);

    return () => {
      done = true;
      try {
        document.body.removeChild(script);
      } catch {
        // already gone
      }
      delete (window as unknown as Record<string, unknown>)[CALLBACK];
    };
  }, [state]);

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

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Connect Farcaster"
      onClick={onClose}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <span className={styles.eyebrow}>{t("channels.connect")}</span>
            <span className={styles.title}>Farcaster</span>
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
              Sign in with your Farcaster account through Neynar. A signer is
              created and authorized for you — no manual UUID needed.
            </span>
          </div>

          {/* The SIWN script renders the "Sign in with Neynar" button here. */}
          <div
            className="neynar_signin"
            data-client_id={clientId}
            data-success-callback={CALLBACK}
            data-theme="dark"
            style={{ display: "flex", justifyContent: "center", minHeight: 48 }}
          />

          {phase === "connecting" && (
            <div className={styles.label}>✓ Authorized — connecting…</div>
          )}
          {phase === "error" && error && (
            <div className={styles.formError}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
