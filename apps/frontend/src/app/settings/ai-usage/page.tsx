"use client";

import { PageHeader, Card } from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";

export default function AiUsageSettingsPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const usage = user?.aiUsage;

  if (!user?.isPlatformAi) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsAiUsage.title")}
        subtitle={t("settingsAiUsage.selfHosted")}
      />
    );
  }

  if (!usage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsAiUsage.title")}
        subtitle={t("settingsAiUsage.loading")}
      />
    );
  }

  const unlimited = usage.limit === null;
  const limit = usage.limit ?? 0;
  const percent = unlimited || limit === 0 ? 0 : Math.min(100, (usage.used / limit) * 100);
  const renewalDate = new Date(usage.renewsAt).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsAiUsage.title")}
        subtitle={t("settingsAiUsage.subtitle")}
      />

      <Card title={t("settingsAiUsage.period")} subtitle={unlimited ? t("settingsAiUsage.periodUnlimited") : t("settingsAiUsage.periodRenews", { date: renewalDate })}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <Metric label={t("settingsAiUsage.used")} value={String(usage.used)} />
          <Metric label={t("settingsAiUsage.remaining")} value={unlimited ? t("settingsAiUsage.unlimited") : String(usage.remaining)} />
          <Metric label={t("settingsAiUsage.monthlyLimit")} value={unlimited ? t("settingsAiUsage.unlimited") : String(usage.limit)} />
        </div>

        {!unlimited && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 7, fontSize: 12, color: "var(--muted)" }}>
              <span>{t("settingsAiUsage.usedOf", { used: usage.used, limit: usage.limit ?? 0 })}</span>
              <span>{t("settingsAiUsage.renews", { date: renewalDate })}</span>
            </div>
            <div style={{ height: 8, overflow: "hidden", borderRadius: 999, background: "rgba(0,0,0,0.08)" }}>
              <div style={{ width: `${percent}%`, height: "100%", borderRadius: "inherit", background: percent >= 80 ? "#b45309" : "var(--fg)", transition: "width 180ms ease" }} />
            </div>
          </div>
        )}
      </Card>

      <Card title={t("settingsAiUsage.howItWorks")} subtitle={t("settingsAiUsage.howItWorksSubtitle")}>
        <div style={{ display: "grid", gap: 12, fontSize: 13, lineHeight: 1.5 }}>
          <UsageRow title={t("settingsAiUsage.rewrite")} detail={t("settingsAiUsage.rewriteDetail")} />
          <UsageRow title={t("settingsAiUsage.checker")} detail={t("settingsAiUsage.checkerDetail")} />
          <UsageRow title={t("settingsAiUsage.renewal")} detail={t("settingsAiUsage.renewalDetail", { date: renewalDate })} />
        </div>
      </Card>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0, padding: "15px 16px", border: "1px solid var(--line-soft)", borderRadius: 10 }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 650, letterSpacing: "-0.04em", overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function UsageRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-soft)" }}>
      <div style={{ fontWeight: 600, marginBottom: 3 }}>{title}</div>
      <div style={{ color: "var(--muted)" }}>{detail}</div>
    </div>
  );
}
