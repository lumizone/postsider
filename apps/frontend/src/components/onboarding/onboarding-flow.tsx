"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  markOnboardingCompleted,
  readOnboardingProgress,
  saveOnboardingProgress,
  type OnboardingIntent,
} from "@/lib/onboarding-progress";
import { AgentOnboarding } from "./agent-onboarding";
import styles from "./onboarding.module.css";

type Step = "choice" | "welcome" | "connect" | "agent";

/**
 * This choice changes orientation only, not subscriptions or permissions.
 * Email signup, account activation and first-time Google signup already route
 * to /onboarding; existing social connection/OAuth remains in Calendar.
 */
export function OnboardingFlow() {
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuth();
  const t = useT();
  const [step, setStep] = useState<Step>("choice");

  // The calendar offers a resume link after an agent user leaves this page to
  // connect a social provider. Do not auto-resume after onboarding completed.
  useEffect(() => {
    if (!user?.id || !user?.orgId) return;
    const saved = readOnboardingProgress(user.id, user.orgId);
    if (search.get("flow") === "agents" && saved?.intent === "agents" && !saved.completed) {
      setStep("agent");
    }
  }, [user?.id, user?.orgId, search]);

  const choose = (intent: OnboardingIntent) => {
    saveOnboardingProgress(user?.id, user?.orgId, {
      intent,
      completed: false,
      dismissed: false,
    });
    setStep(intent === "agents" ? "agent" : "welcome");
  };

  const finish = () => {
    markOnboardingCompleted(user?.id, user?.orgId);
    router.replace("/calendar");
  };

  const connectSocial = () => {
    markOnboardingCompleted(user?.id, user?.orgId);
    router.replace("/calendar?connect=1");
  };

  const steps: Step[] =
    step === "agent" ? ["choice", "agent"] : ["choice", "welcome", "connect"];

  return (
    <div className={styles.page}>
      <main className={styles.container + (
        step === "choice" || step === "agent" ? " " + styles.wideContainer : ""
      )}>
        <div className={styles.progress} aria-label={t("developerOnboarding.chooseKicker")}>
          {steps.map((part, index) => (
            <span
              key={part}
              aria-hidden="true"
              className={styles.progressDot + (
                steps.indexOf(step) >= index ? " " + styles.progressDotActive : ""
              )}
            />
          ))}
        </div>

        {step === "choice" && (
          <div className={styles.choice}>
            <p className={styles.eyebrow}>{t("developerOnboarding.chooseKicker")}</p>
            <h1 className={styles.choiceTitle}>{t("developerOnboarding.chooseTitle")}</h1>
            <p className={styles.choiceSubtitle}>{t("developerOnboarding.chooseSubtitle")}</p>
            {user?.onTrial && user.trialDaysLeft != null && (
              <p className={styles.trialBadge}>
                {t("onboarding.trialBadge", { days: user.trialDaysLeft })}
              </p>
            )}
            <div className={styles.choiceCards}>
              <button type="button" className={styles.choiceCard} onClick={() => choose("agents")}>
                <span className={styles.choiceIcon} aria-hidden="true">{"{ }"}</span>
                <span className={styles.choiceCardTitle}>
                  {t("developerOnboarding.chooseAgentsTitle")}
                </span>
                <span className={styles.choiceCardDesc}>
                  {t("developerOnboarding.chooseAgentsDescription")}
                </span>
                <span className={styles.choiceMeta}>
                  {t("developerOnboarding.chooseAgentsMeta")}
                </span>
                <span className={styles.choiceArrow} aria-hidden="true">→</span>
              </button>
              <button type="button" className={styles.choiceCard} onClick={() => choose("social")}>
                <span className={styles.choiceIcon} aria-hidden="true">▦</span>
                <span className={styles.choiceCardTitle}>
                  {t("developerOnboarding.chooseSocialTitle")}
                </span>
                <span className={styles.choiceCardDesc}>
                  {t("developerOnboarding.chooseSocialDescription")}
                </span>
                <span className={styles.choiceMeta}>
                  {t("developerOnboarding.chooseSocialMeta")}
                </span>
                <span className={styles.choiceArrow} aria-hidden="true">→</span>
              </button>
            </div>
            <button type="button" className={styles.skipButton} onClick={finish}>
              {t("developerOnboarding.chooseSkip")}
            </button>
          </div>
        )}

        {step === "welcome" && (
          <div className={styles.welcomeLayout}>
            <div className={styles.welcomeLeft}>
              <h1 className={styles.title}>
                {t("onboarding.welcomeTitle", {
                  name: user?.name ? ", " + user.name : "",
                })}
              </h1>
              <p className={styles.subtitle}>{t("onboarding.welcomeSubtitle")}</p>
              {user?.onTrial && user?.trialDaysLeft != null && (
                <p className={styles.trialBadge}>
                  {t("onboarding.trialBadge", { days: user.trialDaysLeft })}
                </p>
              )}
              <ul className={styles.valueProps}>
                <li>
                  <span className={styles.valuePropTitle}>{t("onboarding.valueProp1Title")}</span>
                  <span className={styles.valuePropDesc}>{t("onboarding.valueProp1Desc")}</span>
                </li>
                <li>
                  <span className={styles.valuePropTitle}>{t("onboarding.valueProp2Title")}</span>
                  <span className={styles.valuePropDesc}>{t("onboarding.valueProp2Desc")}</span>
                </li>
                <li>
                  <span className={styles.valuePropTitle}>{t("onboarding.valueProp3Title")}</span>
                  <span className={styles.valuePropDesc}>{t("onboarding.valueProp3Desc")}</span>
                </li>
              </ul>
              <button type="button" className={styles.primaryButton}
                onClick={() => setStep("connect")}>
                {t("onboarding.letsGo")}
              </button>
              <button type="button" className={styles.skipButton} onClick={finish}>
                {t("onboarding.skipSetup")}
              </button>
              <button type="button" className={styles.backButton} onClick={() => setStep("choice")}>
                {t("developerOnboarding.chooseBack")}
              </button>
            </div>
            <div className={styles.welcomeRight}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/onboarding-avatar.png" alt="" className={styles.welcomeImage} />
            </div>
          </div>
        )}

        {step === "connect" && (
          <div className={styles.stepContent}>
            <h1 className={styles.title}>{t("onboarding.connectTitle")}</h1>
            <p className={styles.subtitle}>{t("onboarding.connectDesc")}</p>
            <button type="button" className={styles.primaryButton} onClick={connectSocial}>
              {t("onboarding.connectCta")}
            </button>
            <button type="button" className={styles.skipButton} onClick={finish}>
              {t("onboarding.skipLater")}
            </button>
            <button type="button" className={styles.backButton} onClick={() => setStep("welcome")}>
              {t("developerOnboarding.chooseBack")}
            </button>
          </div>
        )}

        {step === "agent" && (
          <AgentOnboarding onBack={() => setStep("choice")} />
        )}
      </main>
    </div>
  );
}
