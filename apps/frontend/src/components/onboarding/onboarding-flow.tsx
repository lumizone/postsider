"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import styles from "./onboarding.module.css";

type Step = "welcome" | "feature-write" | "feature-agent" | "feature-teams" | "feature-analytics" | "source" | "connect";

const SOURCES = [
  "Google Search",
  "Twitter / X",
  "YouTube",
  "Reddit",
  "LinkedIn",
  "ChatGPT / AI",
  "Friend / Colleague",
  "Blog / Article",
  "Product Hunt",
  "Other",
];

const PLATFORMS = [
  { id: "x", name: "X (Twitter)", icon: "/platforms/x.png" },
  { id: "linkedin", name: "LinkedIn", icon: "/platforms/linkedin.png" },
  { id: "facebook", name: "Facebook", icon: "/platforms/facebook.png" },
  { id: "instagram", name: "Instagram", icon: "/platforms/instagram.png" },
  { id: "tiktok", name: "TikTok", icon: "/platforms/tiktok.png" },
  { id: "youtube", name: "YouTube", icon: "/platforms/youtube.png" },
  { id: "threads", name: "Threads", icon: "/platforms/threads.png" },
  { id: "bluesky", name: "Bluesky", icon: "/platforms/bluesky.png" },
  { id: "pinterest", name: "Pinterest", icon: "/platforms/pinterest.png" },
  { id: "telegram", name: "Telegram", icon: "/platforms/telegram.png" },
  { id: "discord", name: "Discord", icon: "/platforms/discord.png" },
];

export function OnboardingFlow() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();
  const [step, setStep] = useState<Step>("welcome");
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const finish = () => router.replace("/calendar");

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Progress indicator */}
        <div className={styles.progress}>
          {(["welcome", "feature-write", "feature-agent", "feature-teams", "feature-analytics", "source", "connect"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`${styles.progressDot} ${
                (["welcome", "feature-write", "feature-agent", "feature-teams", "feature-analytics", "source", "connect"] as Step[]).indexOf(step) >= i
                  ? styles.progressDotActive
                  : ""
              }`}
            />
          ))}
        </div>

        {step === "welcome" && (
          <WelcomeStep
            name={user?.name || ""}
            onNext={() => setStep("feature-write")}
            onSkip={finish}
          />
        )}
        {step === "feature-write" && (
          <FeatureStep
            title={t("onboarding.featureWriteTitle")}
            description={t("onboarding.featureWriteDesc")}
            image="/brand/onboarding-write.png"
            onNext={() => setStep("feature-agent")}
            onSkip={finish}
          />
        )}
        {step === "feature-agent" && (
          <FeatureStep
            title={t("onboarding.featureAgentTitle")}
            description={t("onboarding.featureAgentDesc")}
            image="/brand/onboarding-agent.png"
            onNext={() => setStep("feature-teams")}
            onSkip={finish}
          />
        )}
        {step === "feature-teams" && (
          <FeatureStep
            title={t("onboarding.featureTeamsTitle")}
            description={t("onboarding.featureTeamsDesc")}
            image="/brand/onboarding-teams.png"
            onNext={() => setStep("feature-analytics")}
            onSkip={finish}
          />
        )}
        {step === "feature-analytics" && (
          <FeatureStep
            title={t("onboarding.featureAnalyticsTitle")}
            description={t("onboarding.featureAnalyticsDesc")}
            image="/brand/onboarding-analytics.png"
            onNext={() => setStep("source")}
            onSkip={finish}
          />
        )}
        {step === "source" && (
          <SourceStep
            selected={selectedSource}
            onSelect={setSelectedSource}
            onNext={() => setStep("connect")}
            onSkip={finish}
          />
        )}
        {step === "connect" && (
          <ConnectStep onSkip={finish} />
        )}
      </div>
    </div>
  );
}

function WelcomeStep({
  name,
  onNext,
  onSkip,
}: {
  name: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const t = useT();
  return (
    <div className={styles.welcomeLayout}>
      <div className={styles.welcomeLeft}>
        <h1 className={styles.title}>
          {t("onboarding.welcomeTitle", { name: name ? `, ${name}` : "" })}
        </h1>
        <p className={styles.subtitle}>
          {t("onboarding.welcomeSubtitle")}
        </p>
        <button className={styles.primaryButton} onClick={onNext}>
          {t("onboarding.letsGo")}
        </button>
        <button className={styles.skipButton} onClick={onSkip}>
          {t("onboarding.skipSetup")}
        </button>
      </div>
      <div className={styles.welcomeRight}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/onboarding-avatar.png"
          alt="PostSider mascot"
          className={styles.welcomeImage}
        />
      </div>
    </div>
  );
}

function FeatureStep({
  title,
  description,
  image,
  onNext,
  onSkip,
}: {
  title: string;
  description: string;
  image: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const t = useT();
  return (
    <div className={styles.welcomeLayout}>
      <div className={styles.welcomeLeft}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{description}</p>
        <button className={styles.primaryButton} onClick={onNext}>
          {t("common.continue")}
        </button>
        <button className={styles.skipButton} onClick={onSkip}>
          {t("common.skip")}
        </button>
      </div>
      <div className={styles.welcomeRight}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt={title}
          className={styles.welcomeImage}
        />
      </div>
    </div>
  );
}

function SourceStep({
  selected,
  onSelect,
  onNext,
  onSkip,
}: {
  selected: string | null;
  onSelect: (v: string) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const t = useT();
  return (
    <div className={styles.stepContent}>
      <h1 className={styles.title}>{t("onboarding.howFound")}</h1>
      <p className={styles.subtitle}>
        {t("onboarding.howFoundDesc")}
      </p>
      <div className={styles.sourceGrid}>
        {SOURCES.map((source) => (
          <button
            key={source}
            className={`${styles.sourceChip} ${
              selected === source ? styles.sourceChipActive : ""
            }`}
            onClick={() => onSelect(source)}
          >
            {source}
          </button>
        ))}
      </div>
      <button
        className={styles.primaryButton}
        onClick={onNext}
        disabled={!selected}
      >
        {t("common.continue")}
      </button>
      <button className={styles.skipButton} onClick={onSkip}>
        {t("common.skip")}
      </button>
    </div>
  );
}

function ConnectStep({ onSkip }: { onSkip: () => void }) {
  const t = useT();
  return (
    <div className={styles.stepContent}>
      <h1 className={styles.title}>{t("onboarding.connectTitle")}</h1>
      <p className={styles.subtitle}>
        {t("onboarding.connectDesc")}
      </p>
      <div className={styles.platformGrid}>
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            className={styles.platformCard}
            onClick={() => {
              window.location.href = `/integrations/social/${p.id}`;
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.icon}
              alt={p.name}
              width={32}
              height={32}
              className={styles.platformIcon}
            />
            <span className={styles.platformName}>{p.name}</span>
          </button>
        ))}
      </div>
      <button className={styles.skipButton} onClick={onSkip}>
        {t("onboarding.skipLater")}
      </button>
    </div>
  );
}
