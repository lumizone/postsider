"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "./auth-shell";
import styles from "./auth.module.css";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";

export function ActivateClient({ token }: { token: string }) {
  const t = useT();
  const router = useRouter();
  const { refresh } = useAuth();
  const [error, setError] = useState(false);
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    (async () => {
      try {
        const res = await api.post<{ can: boolean }>(
          "/auth/activate",
          { code: token },
          { anonymous: true, silent: true },
        );
        if (!res?.can) {
          setError(true);
          return;
        }
        // Activation sets the auth cookie server-side; pick up the session and
        // send the fresh account into onboarding.
        await refresh();
        router.replace("/onboarding");
      } catch {
        setError(true);
      }
    })();
  }, [token, refresh, router]);

  if (error) {
    return (
      <AuthShell
        title={t("auth.activateErrorTitle")}
        subtitle={t("auth.activateErrorSubtitle")}
        footer={<Link href="/login">{t("auth.backToSignIn")}</Link>}
      >
        <Link href="/login" className={styles.submitLink}>
          {t("auth.backToSignIn")}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.activateChecking")}
      subtitle={t("auth.activatePendingSubtitle")}
    >
      <></>
    </AuthShell>
  );
}
