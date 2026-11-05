"use client";

import type { AgentGroup } from "@/lib/agent-activity-api";
import { BUCKET_WEIGHT, bucketLabelKey } from "@/lib/agent-activity-model";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { platformFromIdentifier } from "@/lib/integrations";
import { PlatformIcon } from "@/components/platform-icon";
import { actorName, actorTypeLabel } from "./actor-label";
import { AgentActions, type AgentActionsApi } from "./agent-actions";
import s from "./agent-activity.module.css";

const MAX_CHIPS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

const WEIGHT_CLASS = {
  filled: s.wFilled,
  outline: s.wOutline,
  dotted: s.wDotted,
  struck: s.wStruck,
  plain: s.wPlain,
} as const;

/** Relative for the last week, a locale date and time after that. */
function formatWhen(iso: string, locale: string): { text: string; full: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: "", full: "" };
  const full = d.toLocaleString(locale);
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs >= 7 * DAY_MS) return { text: full, full };
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60 * 1000) return { text: rtf.format(0, "second"), full };
  if (abs < 60 * 60 * 1000) return { text: rtf.format(Math.round(diff / 60000), "minute"), full };
  if (abs < DAY_MS) return { text: rtf.format(Math.round(diff / 3600000), "hour"), full };
  return { text: rtf.format(Math.round(diff / DAY_MS), "day"), full };
}

interface Props {
  group: AgentGroup;
  selectable: boolean;
  selected: boolean;
  onToggle: (group: string) => void;
  onOpen: (group: AgentGroup) => void;
  actions: AgentActionsApi;
  role: string | undefined;
}

export function AgentGroupRow({ group, selectable, selected, onToggle, onOpen, actions, role }: Props) {
  const { t, locale } = useI18n();
  const weight = BUCKET_WEIGHT[group.bucket];
  const when = formatWhen(group.updatedAt, locale);
  const creator = group.createdBy ?? group.lastModifiedBy;
  const creatorType = actorTypeLabel(t, creator);
  const chips = group.destinations.slice(0, MAX_CHIPS);
  const more = group.destinations.length - chips.length;
  const preview = group.contentPreview.trim() || t("agentActivity.list.noText");
  const claimedName = group.claimed.agentName?.trim();

  return (
    <li className={s.row}>
      {selectable ? (
        <label className={s.rowCheck}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(group.group)}
            aria-label={t("agentActivity.list.selectGroup")}
          />
        </label>
      ) : null}
      <button
        type="button"
        className={s.rowMain}
        onClick={() => onOpen(group)}
        aria-label={t("agentActivity.list.open") + ": " + preview.slice(0, 60)}
      >
        <span className={s.rowTop}>
          <span className={s.chips}>
            {chips.map((d) => {
              const platform = platformFromIdentifier(d.providerIdentifier);
              const differs = d.bucket !== group.bucket;
              return (
                <span key={d.postId} className={s.chip}>
                  {platform ? <PlatformIcon platform={platform} size={16} /> : null}
                  <span className={s.chipName}>{d.integrationName}</span>
                  {differs ? (
                    <span className={s.chipBucket + " " + WEIGHT_CLASS[BUCKET_WEIGHT[d.bucket]]}>
                      {t(bucketLabelKey(d.bucket) as MessageKey)}
                    </span>
                  ) : null}
                </span>
              );
            })}
            {more > 0 ? (
              <span className={s.chip}>{t("agentActivity.list.moreDestinations", { count: more })}</span>
            ) : null}
          </span>
          <span className={s.badge + " " + WEIGHT_CLASS[weight]}>
            {t(bucketLabelKey(group.bucket) as MessageKey)}
          </span>
        </span>
        <span className={s.preview}>{preview}</span>
        <span className={s.meta}>
          <span>
            {t("agentActivity.list.byActor", { name: actorName(t, creator) })}
            {creatorType ? ` (${creatorType})` : ""}
          </span>
          {claimedName ? (
            <span>{t("agentActivity.list.claimedAgent", { name: claimedName })}</span>
          ) : null}
          {when.text ? (
            <time dateTime={group.updatedAt} title={when.full}>
              {when.text}
            </time>
          ) : null}
        </span>
      </button>
      <AgentActions
        className={s.rowActions}
        actions={actions}
        role={role}
        group={group.group}
        canRetry={group.canRetry}
        buckets={group.destinations.map((d) => d.bucket)}
        pendingIds={group.pendingApprovalIds}
      />
    </li>
  );
}
