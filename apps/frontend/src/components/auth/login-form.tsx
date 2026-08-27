"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "./auth-shell";
import { BetaBanner, PRIVATE_BETA } from "./beta";
import { GoogleButton } from "./google-button";
import styles from "./auth.module.css";
import { api, ApiError, setAuthToken, setOrgId } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const search = useSearchParams();
  const { refresh } = useAuth();
  const inviteToken = search.get("org");
  const reason = search.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    reason === "access"
      ? t("access.changedDesc")
      : null,
  );
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    const body: Record<string, unknown> = {
      email,
      password,
      provider: "LOCAL",
    };
    if (inviteToken) body.org = inviteToken;

    try {
      const result = await api.post<{
        mfaRequired?: boolean;
        mfaEnrollmentRequired?: boolean;
      }>("/auth/login", body, {
        anonymous: true,
        silent: true,
      });
      if (result?.mfaEnrollmentRequired) {
        router.replace("/login/mfa/enroll");
        return;
      }
      if (result?.mfaRequired) {
        router.replace("/login/mfa");
        return;
      }
      await refresh();

      // If joining via invite, bind to the org.
      if (inviteToken) {
        try {
          await api.post("/user/join-org", { org: inviteToken }, { silent: true });
          await refresh();
        } catch (inviteError) {
          setError(
            inviteError instanceof ApiError
              ? inviteError.message
              : t("auth.signInError")
          );
          return;
        }
      }

      router.replace("/calendar");
    } catch (err) {
      setAuthToken(null);
      setOrgId(null);
      const message =
        err instanceof ApiError ? err.message : t("auth.signInError");
      setError(message || t("auth.signInError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t("auth.welcomeBack")}
      subtitle={t("auth.signInSubtitle")}
      banner={PRIVATE_BETA ? <BetaBanner /> : undefined}
      footer={
        PRIVATE_BETA ? (
          <>
            {t("auth.betaFooterQuestion")}{" "}
            <a href="https://postsider.com" target="_blank" rel="noreferrer">
              {t("auth.betaFooterCta")}
            </a>
          </>
        ) : (
          <>
            {t("auth.noAccount")}{" "}
            <Link href="/register">{t("auth.createOne")}</Link>
          </>
        )
      }
    >
      {!PRIVATE_BETA && (
        <>
          <GoogleButton label={t("auth.googleSignIn")} />

          <div className={styles.divider}>
            <span>{t("common.or")}</span>
          </div>
        </>
      )}

      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            {t("auth.email")}
          </label>
          <input
            id="email"
            type="email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            {t("auth.password")}
          </label>
          <input
            id="password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            minLength={3}
          />
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? t("auth.signingIn") : t("auth.signIn")}
        </button>
      </form>

      <div className={styles.forgotLink}>
        <Link href="/forgot">{t("auth.forgotPassword")}</Link>
      </div>
    </AuthShell>
  );
}
