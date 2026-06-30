"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AuthShell } from "./auth-shell";
import styles from "./auth.module.css";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

export function ForgotForm() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      await api.post(
        "/auth/forgot",
        { email },
        { anonymous: true, silent: true },
      );
    } catch {
      // Ignore — never reveal whether the address exists (no enumeration).
    } finally {
      setLoading(false);
      // Always show the same confirmation regardless of the result.
      setSent(true);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title={t("auth.forgotSentTitle")}
        subtitle={t("auth.forgotSentSubtitle")}
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
      title={t("auth.forgotTitle")}
      subtitle={t("auth.forgotSubtitle")}
      footer={<Link href="/login">{t("auth.backToSignIn")}</Link>}
    >
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
            placeholder={t("auth.emailPlaceholder")}
          />
        </div>
        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? t("auth.forgotSending") : t("auth.forgotSubmit")}
        </button>
      </form>
    </AuthShell>
  );
}
