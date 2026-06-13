"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "./auth-shell";
import styles from "./auth.module.css";
import { api, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useT();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (password.length < 8) {
      setError(t("auth.passwordMin6"));
      return;
    }
    if (password !== repeat) {
      setError(t("auth.passwordsNoMatch"));
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{ reset: boolean }>(
        "/auth/forgot-return",
        { password, repeatPassword: repeat, token },
        { anonymous: true, silent: true },
      );
      if (!res?.reset) {
        setError(t("auth.resetError"));
        return;
      }
      setDone(true);
      setTimeout(() => router.replace("/login"), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.resetError"));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthShell
        title={t("auth.resetDoneTitle")}
        subtitle={t("auth.resetDoneSubtitle")}
        footer={<Link href="/login">{t("auth.backToSignIn")}</Link>}
      >
        <Link href="/login" className={styles.submit} style={{ textAlign: "center" }}>
          {t("auth.backToSignIn")}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.resetTitle")}
      subtitle={t("auth.resetSubtitle")}
      footer={<Link href="/login">{t("auth.backToSignIn")}</Link>}
    >
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            {t("auth.newPassword")}
          </label>
          <input
            id="password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            autoFocus
            placeholder={t("auth.passwordPlaceholder6")}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="repeat">
            {t("auth.confirmPassword")}
          </label>
          <input
            id="repeat"
            type="password"
            className={styles.input}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t("auth.confirmPasswordPlaceholder")}
          />
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? t("auth.resetting") : t("auth.resetSubmit")}
        </button>
      </form>
    </AuthShell>
  );
}
