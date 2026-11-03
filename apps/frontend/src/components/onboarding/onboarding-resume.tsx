"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  readOnboardingProgress,
  saveOnboardingProgress,
} from "@/lib/onboarding-progress";
import styles from "./onboarding-resume.module.css";

/**
 * OAuth/social providers return to Calendar. Keep one non-blocking link here
 * so an agent-first user can finish the in-app MCP/API setup afterwards.
 * Dismissal is local to the current user and organization, and does NOT claim
 * a successful connection or a draft that hasn't been checked.
 */
export function OnboardingResumeBanner() {
  const { user } = useAuth();
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const state = readOnboardingProgress(user?.id, user?.orgId);
    setVisible(state?.intent === "agents" && !state.completed && !state.dismissed);
  }, [user?.id, user?.orgId]);

  const dismiss = () => {
    const saved = readOnboardingProgress(user?.id, user?.orgId);
    if (saved?.intent === "agents" && !saved.completed) {
      saveOnboardingProgress(user?.id, user?.orgId, { ...saved, dismissed: true });
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <section className={styles.banner} aria-labelledby="resume-onboarding-title">
      <span className={styles.icon} aria-hidden="true">{"{ }"}</span>
      <div className={styles.copy}>
        <h2 id="resume-onboarding-title">{t("developerOnboarding.resumeTitle")}</h2>
        <p>{t("developerOnboarding.resumeDescription")}</p>
      </div>
      <div className={styles.actions}>
        <Link href="/onboarding?flow=agents" className={styles.primaryLink}>
          {t("developerOnboarding.resumeAction")}
        </Link>
        <button type="button" onClick={dismiss} className={styles.dismiss}>
          {t("developerOnboarding.resumeDismiss")}
        </button>
      </div>
    </section>
  );
}
