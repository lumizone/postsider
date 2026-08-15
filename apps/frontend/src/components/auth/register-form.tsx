"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "./auth-shell";
import { BetaBanner, PRIVATE_BETA } from "./beta";
import { GoogleButton } from "./google-button";
import styles from "./auth.module.css";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";

export function RegisterForm() {
  const t = useT();
  const router = useRouter();
  const { refresh } = useAuth();
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activationRequired, setActivationRequired] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (orgName.trim().length < 3) {
      setError(t("auth.orgNameMin3"));
      return;
    }

    if (password.length < 8) {
      setError(t("auth.passwordMin8"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("auth.passwordsNoMatch"));
      return;
    }

    setLoading(true);

    try {
      const res = await api.post<{ register?: boolean; activate?: boolean }>(
        "/auth/register",
        {
          email,
          password,
          company: orgName.trim(),
          provider: "LOCAL",
        },
        { anonymous: true, silent: true },
      );

      if (res?.activate) {
        setActivationRequired(true);
        return;
      }

      await refresh();
      router.replace("/onboarding");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : t("auth.registerError");
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // During the private beta the server rejects every registration, so don't
  // render a form that can only fail — send people to the whitelist instead.
  if (PRIVATE_BETA) {
    return (
      <AuthShell
        title={t("auth.betaTitle")}
        subtitle={t("auth.betaRegisterInfo")}
        banner={<BetaBanner />}
        footer={
          <>
            {t("auth.betaHaveAccount")}{" "}
            <Link href="/login">{t("auth.signIn")}</Link>
          </>
        }
      >
        <a
          href="https://postsider.com"
          target="_blank"
          rel="noreferrer"
          className={styles.submitLink}
        >
          {t("auth.betaJoinWhitelist")}
        </a>
      </AuthShell>
    );
  }

  if (activationRequired) {
    return (
      <AuthShell
        title={t("auth.checkEmailTitle")}
        subtitle={t("auth.checkEmailSubtitle")}
      >
        <div className={styles.notice}>
          {t("auth.didntReceive")}{" "}
          <Link href="/login" style={{ fontWeight: 600, color: "var(--fg)" }}>
            {t("auth.trySigningIn")}
          </Link>
          .
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.registerTitle")}
      subtitle={t("auth.registerSubtitle")}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link href="/login">{t("auth.signIn")}</Link>
        </>
      }
    >
      <GoogleButton label={t("auth.googleSignUp")} />

      <div className={styles.divider}>
        <span>{t("common.or")}</span>
      </div>

      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-name">
            {t("auth.yourName")}
          </label>
          <input
            id="reg-name"
            type="text"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            autoFocus
            placeholder={t("auth.namePlaceholder")}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-org-name">
            {t("auth.orgName")}
          </label>
          <input
            id="reg-org-name"
            type="text"
            className={styles.input}
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            autoComplete="organization"
            required
            minLength={3}
            placeholder={t("auth.orgNamePlaceholder")}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-email">
            {t("auth.email")}
          </label>
          <input
            id="reg-email"
            type="email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder={t("auth.emailPlaceholder")}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-password">
            {t("auth.password")}
          </label>
          <input
            id="reg-password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={8}
            placeholder={t("auth.passwordPlaceholder8")}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-confirm">
            {t("auth.confirmPassword")}
          </label>
          <input
            id="reg-confirm"
            type="password"
            className={styles.input}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={8}
            placeholder={t("auth.confirmPasswordPlaceholder")}
          />
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? t("auth.creatingAccount") : t("auth.createAccount")}
        </button>
      </form>
    </AuthShell>
  );
}
