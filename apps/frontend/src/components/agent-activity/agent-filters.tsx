"use client";

import { DatePicker } from "@/components/date-picker";
import type { AgentFilterOptions } from "@/lib/agent-activity-api";
import { DEFAULT_FILTERS, MAX_INTEGRATION_IDS, hasActiveFilters, type AgentFilters } from "@/lib/agent-activity-filters";
import { FILTER_BUCKETS, bucketLabelKey } from "@/lib/agent-activity-model";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { platformFromIdentifier } from "@/lib/integrations";
import { PlatformIcon } from "@/components/platform-icon";
import { actorName, actorTypeLabel } from "./actor-label";
import s from "./agent-activity.module.css";

export interface ChannelOption {
  id: string;
  name: string;
  identifier: string;
}

interface Props {
  filters: AgentFilters;
  options: AgentFilterOptions | null;
  channels: ChannelOption[];
  onChange: (next: AgentFilters) => void;
}

export function AgentFiltersBar({ filters, options, channels, onChange }: Props) {
  const t = useT();
  const set = (patch: Partial<AgentFilters>) => onChange({ ...filters, ...patch });

  const toggleChannel = (id: string) => {
    const has = filters.integrationIds.includes(id);
    const next = has
      ? filters.integrationIds.filter((x) => x !== id)
      : [...filters.integrationIds, id];
    set({ integrationIds: next.slice(0, MAX_INTEGRATION_IDS) });
  };

  const channelSummary =
    filters.integrationIds.length === 0
      ? t("agentActivity.filter.channels")
      : t("agentActivity.filter.channelsSelected", { count: filters.integrationIds.length });

  // A URL value that is not in the loaded options (shared link, options still loading)
  // stays visible as applied instead of showing "Any".
  const extraOption = (value: string, known: string[]) =>
    value && !known.includes(value) ? (
      <option key="__unknown" value={value}>
        {t("agentActivity.filter.unknownValue", { value })}
      </option>
    ) : null;

  // A bucket from the URL that is not in the segmented control (for example
  // "retryable") is still shown as the current selection.
  const buckets = FILTER_BUCKETS.includes(filters.bucket)
    ? FILTER_BUCKETS
    : [...FILTER_BUCKETS, filters.bucket];

  return (
    <div className={s.filters}>
      <div className={s.segmented} role="group" aria-label={t("agentActivity.filter.status")}>
        {buckets.map((b) => (
          <button
            key={b}
            type="button"
            className={s.segment + (filters.bucket === b ? " " + s.segmentOn : "")}
            aria-pressed={filters.bucket === b}
            onClick={() => set({ bucket: b })}
          >
            {t(bucketLabelKey(b) as MessageKey)}
          </button>
        ))}
      </div>

      <div className={s.filterRow}>
        <details className={s.multi}>
          <summary className={s.control}>{channelSummary}</summary>
          <div className={s.multiPanel}>
            {channels.map((c) => {
              const checked = filters.integrationIds.includes(c.id);
              const platform = platformFromIdentifier(c.identifier);
              return (
                <label key={c.id} className={s.multiItem}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && filters.integrationIds.length >= MAX_INTEGRATION_IDS}
                    onChange={() => toggleChannel(c.id)}
                  />
                  {platform ? <PlatformIcon platform={platform} size={16} /> : null}
                  <span className={s.multiName}>{c.name}</span>
                </label>
              );
            })}
          </div>
        </details>

        <label className={s.field}>
          <span className={s.fieldLabel}>{t("agentActivity.filter.actor")}</span>
          <select
            className={s.control}
            value={filters.actor}
            onChange={(e) => set({ actor: e.target.value })}
          >
            <option value="">{t("agentActivity.filter.any")}</option>
            {extraOption(filters.actor, (options?.actors ?? []).map((a) => a.key))}
            {(options?.actors ?? []).map((a) => {
              const display = { type: a.type, id: a.id, name: a.name, state: a.state, authorizedBy: null };
              const type = actorTypeLabel(t, display);
              return (
                <option key={a.key} value={a.key}>
                  {actorName(t, display)}
                  {type ? ` (${type})` : ""}
                </option>
              );
            })}
          </select>
        </label>

        <label className={s.field}>
          <span className={s.fieldLabel}>{t("agentActivity.filter.agent")}</span>
          <select
            className={s.control}
            value={filters.agentName}
            onChange={(e) => set({ agentName: e.target.value })}
          >
            <option value="">{t("agentActivity.filter.any")}</option>
            {extraOption(filters.agentName, (options?.agentNames ?? []).map((o) => o.value))}
            {(options?.agentNames ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className={s.field}>
          <span className={s.fieldLabel}>{t("agentActivity.filter.source")}</span>
          <select
            className={s.control}
            value={filters.source}
            onChange={(e) => set({ source: e.target.value })}
          >
            <option value="">{t("agentActivity.filter.any")}</option>
            {extraOption(filters.source, (options?.sources ?? []).map((o) => o.value))}
            {(options?.sources ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className={s.field}>
          <span className={s.fieldLabel}>{t("agentActivity.filter.from")}</span>
          <span className={s.dateWrap}>
            <DatePicker value={filters.from} onChange={(v) => set({ from: v })} />
            {filters.from ? (
              <button
                type="button"
                className={s.clearBtn}
                aria-label={t("common.remove")}
                onClick={() => set({ from: "" })}
              >
                &times;
              </button>
            ) : null}
          </span>
        </div>

        <div className={s.field}>
          <span className={s.fieldLabel}>{t("agentActivity.filter.to")}</span>
          <span className={s.dateWrap}>
            <DatePicker value={filters.to} onChange={(v) => set({ to: v })} />
            {filters.to ? (
              <button
                type="button"
                className={s.clearBtn}
                aria-label={t("common.remove")}
                onClick={() => set({ to: "" })}
              >
                &times;
              </button>
            ) : null}
          </span>
        </div>

        <label className={s.check}>
          <input
            type="checkbox"
            checked={filters.scope === "automation"}
            onChange={(e) => set({ scope: e.target.checked ? "automation" : "relevant" })}
          />
          <span>{t("agentActivity.filter.onlyAutomation")}</span>
        </label>

        {hasActiveFilters(filters) ? (
          <button type="button" className={s.ghost} onClick={() => onChange(DEFAULT_FILTERS)}>
            {t("agentActivity.filter.reset")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
