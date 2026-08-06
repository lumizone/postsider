"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import styles from "./onboarding.module.css";

type Step = "welcome" | "connect";

/**
 * First-run flow for a freshly registered account.
 *
 * Deliberately two steps: a welcome that says what happens next, then the
 * single action that unlocks the product (connect a channel). The previous
 * version walked through four static feature slides and an attribution
 * question before ever reaching that action, so the one step that mattered
 * sat behind six that did not.
 *
 * Connecting is NOT reimplemented here. Each provider needs a different
 * handoff (OAuth redirect, custom-credential form, Telegram's /connect code,
 * Farcaster's SIWN widget) and the calendar already branches across all of
 * them in addChannelForPlatform. This hands off to `/calendar?connect=1`,
 * which opens that same picker — one connect implementation, and no local
 * copy of the platform list to drift out of sync (the old hardcoded list
 * already had to be hand-edited when Threads was hidden).
 */
export function OnboardingFlow() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();
  const [step, setStep] = useState<Step>("welcome");

  const finish = () => router.replace("/calendar");
  const startConnect = () => router.replace("/calendar?connect=1");

  const steps: Step[] = ["welcome", "connect"];

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.progress}>
          {steps.map((s, i) => (
            <div
              key={s}
              className={`${styles.progressDot} ${
                steps.indexOf(step) >= i ? styles.progressDotActive : ""
              }`}
            />
          ))}
        </div>

        {step === "welcome" && (
          <div className={styles.welcomeLayout}>
            <div className={styles.welcomeLeft}>
              <h1 className={styles.title}>
                {t("onboarding.welcomeTitle", {
                  name: user?.name ? `, ${user.name}` : "",
                })}
              </h1>
              <p className={styles.subtitle}>{t("onboarding.welcomeSubtitle")}</p>
              <button
                className={styles.primaryButton}
                onClick={() => setStep("connect")}
              >
                {t("onboarding.letsGo")}
              </button>
              <button className={styles.skipButton} onClick={finish}>
                {t("onboarding.skipSetup")}
              </button>
            </div>
            <div className={styles.welcomeRight}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/onboarding-avatar.png"
                alt=""
                className={styles.welcomeImage}
              />
            </div>
          </div>
        )}

        {step === "connect" && (
          <div className={styles.stepContent}>
            <h1 className={styles.title}>{t("onboarding.connectTitle")}</h1>
            <p className={styles.subtitle}>{t("onboarding.connectDesc")}</p>
            <button className={styles.primaryButton} onClick={startConnect}>
              {t("onboarding.connectCta")}
            </button>
            <button className={styles.skipButton} onClick={finish}>
              {t("onboarding.skipLater")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
