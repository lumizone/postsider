"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "./auth-shell";
import styles from "./auth.module.css";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";

/**
 * First-time account setup — shown once after the operator logs in with the
 * bootstrap password. They set their real email, name and new password.
 */
export function SetupForm() {
  const t = useT();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Pre-fill email from current user if it's a real one (not the bootstrap placeholder).
  useEffect(() => {
    if (user?.email && user.email !== "admin@setup.local") {
      setEmail(user.email);
    }
  }, [user?.email]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (password !== confirmPassword) {
      setError(t("auth.passwordsNoMatch"));
      return;
    }
    if (password.length < 3) {
      setError(t("auth.passwordMin3"));
      return;
    }
    if (!email || !/.+@.+\..+/.test(email)) {
      setError(t("auth.invalidEmail"));
      return;
    }

    setLoading(true);
    try {
      await api.post("/user/setup", {
        email,
        name: name || undefined,
        password,
      });
      await refresh();
      router.replace("/calendar");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : t("auth.setupError");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t("auth.setupTitle")}
      subtitle={t("auth.setupSubtitle")}
    >
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="setup-email">
            {t("auth.email")}
          </label>
          <input
            id="setup-email"
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
        <div className={styles.field}>
          <label className={styles.label} htmlFor="setup-name">
            {t("auth.nameOptional")}
          </label>
          <input
            id="setup-name"
            type="text"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder={t("auth.yourName")}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="setup-password">
            {t("auth.newPassword")}
          </label>
          <input
            id="setup-password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={3}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="setup-confirm">
            {t("auth.confirmPassword")}
          </label>
          <input
            id="setup-confirm"
            type="password"
            className={styles.input}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={3}
          />
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? t("auth.settingUp") : t("auth.completeSetup")}
        </button>
      </form>
    </AuthShell>
  );
}
