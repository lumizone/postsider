"use client";

import type { TimelineItem } from "@/lib/agent-activity-api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { ActorLabel } from "./actor-label";
import { errorKey } from "./agent-group-drawer-helpers";
import s from "./agent-activity.module.css";

const KNOWN_EVENTS = new Set([
  "post.created",
  "post.updated",
  "post.deleted",
  "post.status_changed",
  "post.approval_requested",
  "post.approval_resolved",
  "post.published",
  "post.failed",
  "post.retry_requested",
  "post.policy_evaluated",
  "policy.changed",
]);

const EFFECTS = new Set(["ALLOW", "REQUIRE_APPROVAL", "BLOCK"]);
const PHASES = new Set(["write", "publish"]);

function str(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Events newest first, with localized labels. Every server value is plain text. */
export function AgentTimeline({ items }: { items: TimelineItem[] }) {
  const { t, locale } = useI18n();

  if (items.length === 0) {
    return <p className={s.muted}>{t("agentActivity.drawer.timelineEmpty")}</p>;
  }

  const sorted = [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <ol className={s.timeline}>
      {sorted.map((item) => {
        const known = KNOWN_EVENTS.has(item.type);
        const label = known
          ? t(`agentActivity.event.${item.type.replace(/\./g, "_")}` as MessageKey)
          : item.type;
        const when = new Date(item.createdAt);
        const meta = item.metadata ?? {};
        const details: string[] = [];

        if (item.type === "post.failed") {
          if (meta.errorCategory !== undefined && meta.errorCategory !== null) {
            details.push(t(errorKey(str(meta.errorCategory)) as MessageKey));
          }
          if (typeof meta.errorRetryable === "boolean") {
            details.push(
              meta.errorRetryable
                ? t("agentActivity.drawer.canRetry")
                : t("agentActivity.drawer.cannotRetry"),
            );
          }
        } else if (item.type === "post.policy_evaluated") {
          const effect = str(meta.effect);
          if (effect) {
            details.push(
              EFFECTS.has(effect) ? t(`agentActivity.effect.${effect}` as MessageKey) : effect,
            );
          }
          const phase = str(meta.phase);
          if (phase) {
            details.push(
              PHASES.has(phase)
                ? `${t("agentActivity.drawer.policyPhase")}: ${t(`agentActivity.phase.${phase}` as MessageKey)}`
                : phase,
            );
          }
          const rules = str(meta.ruleNames);
          if (rules) details.push(`${t("agentActivity.drawer.policyRules")}: ${rules}`);
        }

        const actor =
          item.actor.type === "GUEST" ? (
            <span>{t("agentActivity.actor.guest")}</span>
          ) : (
            <ActorLabel actor={item.actor} />
          );

        return (
          <li key={item.id} className={s.timelineItem}>
            <div className={s.timelineTop}>
              <strong>{label}</strong>
              {Number.isNaN(when.getTime()) ? null : (
                <time dateTime={item.createdAt} className={s.muted}>
                  {when.toLocaleString(locale)}
                </time>
              )}
            </div>
            <div className={s.muted}>{actor}</div>
            {details.map((d, i) => (
              <div key={i} className={s.timelineDetail}>
                {d}
              </div>
            ))}
          </li>
        );
      })}
    </ol>
  );
}
