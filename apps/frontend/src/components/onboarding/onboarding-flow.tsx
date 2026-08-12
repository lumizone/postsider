"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { updateOrganizationProfile } from "@/lib/organization-api";
import { useT, type MessageKey } from "@/lib/i18n";
import styles from "./onboarding.module.css";

type Step = "welcome" | "attribution" | "instructions" | "connect";

const ATTRIBUTION_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "search", labelKey: "onboarding.attributionSearch" },
  { value: "social", labelKey: "onboarding.attributionSocial" },
  { value: "friend", labelKey: "onboarding.attributionFriend" },
  { value: "video", labelKey: "onboarding.attributionVideo" },
  { value: "community", labelKey: "onboarding.attributionCommunity" },
  { value: "other", labelKey: "onboarding.attributionOther" },
];

/**
 * First-run flow for a freshly registered account.
 *
 * Four steps: welcome, a one-tap attribution question (saved on the org —
 * this exact question existed before 2026-08-06 too, but the answer was
 * collected and thrown away; see Organization.referralSource), a static
 * "two ways to publish" screen (dashboard vs Public API/MCP — the latter
 * was never mentioned anywhere in onboarding before), then the one action
 * that actually unlocks the product (connect a channel).
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
  const [savingAttribution, setSavingAttribution] = useState(false);

  const finish = () => router.replace("/calendar");
  const startConnect = () => router.replace("/calendar?connect=1");

  const chooseAttribution = async (value: string) => {
    if (savingAttribution) return;
    setSavingAttribution(true);
    try {
      // Best-effort: a failed save must not trap the user on this step —
      // it's a one-tap nicety, not something worth blocking onboarding over.
      await updateOrganizationProfile({ referralSource: value });
    } catch {
      // ignore
    } finally {
      setSavingAttribution(false);
      setStep("instructions");
    }
  };

  const steps: Step[] = ["welcome", "attribution", "instructions", "connect"];

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
              {/* Only when this account actually got one — a second org
                  from an existing user, or any org once TrialUsage has
                  already recorded the email, never receives a trial (see
                  organization.service.ts createOrgAndUser/
                  createOrgForCurrentUser), so this must follow the real
                  flag and not be shown unconditionally. */}
              {user?.onTrial && user?.trialDaysLeft != null && (
                <p className={styles.trialBadge}>
                  {t("onboarding.trialBadge", { days: user.trialDaysLeft })}
                </p>
              )}
              <ul className={styles.valueProps}>
                <li>
                  <span className={styles.valuePropTitle}>
                    {t("onboarding.valueProp1Title")}
                  </span>
                  <span className={styles.valuePropDesc}>
                    {t("onboarding.valueProp1Desc")}
                  </span>
                </li>
                <li>
                  <span className={styles.valuePropTitle}>
                    {t("onboarding.valueProp2Title")}
                  </span>
                  <span className={styles.valuePropDesc}>
                    {t("onboarding.valueProp2Desc")}
                  </span>
                </li>
                <li>
                  <span className={styles.valuePropTitle}>
                    {t("onboarding.valueProp3Title")}
                  </span>
                  <span className={styles.valuePropDesc}>
                    {t("onboarding.valueProp3Desc")}
                  </span>
                </li>
              </ul>
              <button
                className={styles.primaryButton}
                onClick={() => setStep("attribution")}
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

        {step === "attribution" && (
          <div className={styles.stepContent}>
            <h1 className={styles.title}>{t("onboarding.attributionTitle")}</h1>
            <p className={styles.subtitle}>{t("onboarding.attributionSubtitle")}</p>
            <div className={styles.optionList}>
              {ATTRIBUTION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={styles.optionButton}
                  disabled={savingAttribution}
                  onClick={() => void chooseAttribution(opt.value)}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
            <button className={styles.skipButton} onClick={() => setStep("instructions")}>
              {t("onboarding.attributionSkip")}
            </button>
          </div>
        )}

        {step === "instructions" && (
          <div className={styles.stepContent}>
            <h1 className={styles.title}>{t("onboarding.instructionsTitle")}</h1>
            <p className={styles.subtitle}>{t("onboarding.instructionsSubtitle")}</p>
            <div className={styles.instructionCards}>
              <div className={styles.instructionCard}>
                <span className={styles.instructionCardTitle}>
                  {t("onboarding.instructionsDashboardTitle")}
                </span>
                <span className={styles.instructionCardDesc}>
                  {t("onboarding.instructionsDashboardDesc")}
                </span>
              </div>
              <div className={styles.instructionCard}>
                <span className={styles.instructionCardTitle}>
                  {t("onboarding.instructionsApiTitle")}
                </span>
                <span className={styles.instructionCardDesc}>
                  {t("onboarding.instructionsApiDesc")}
                </span>
                <a
                  href="/settings/api"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.instructionCardLink}
                >
                  {t("onboarding.instructionsApiCta")}
                </a>
              </div>
            </div>
            <button className={styles.primaryButton} onClick={() => setStep("connect")}>
              {t("onboarding.instructionsNext")}
            </button>
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
