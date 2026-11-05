"use client";

import type { AgentSummary } from "@/lib/agent-activity-api";
import type { AgentFilters } from "@/lib/agent-activity-filters";
import { TILE_BUCKET } from "@/lib/agent-activity-model";
import { useT } from "@/lib/i18n";
import s from "./agent-activity.module.css";

interface Props {
  summary: AgentSummary | null;
  filters: AgentFilters;
  onBucket: (bucket: AgentFilters["bucket"]) => void;
}

export function AgentSummaryBar({ summary, filters, onBucket }: Props) {
  const t = useT();
  const num = (n: number | undefined) => (n === undefined ? "-" : String(n));

  const pressable = [
    { key: "review", label: t("agentActivity.tile.review"), value: summary?.waitingForReview },
    { key: "blocked", label: t("agentActivity.tile.blocked"), value: summary?.policyBlocked },
    { key: "failed", label: t("agentActivity.tile.failed"), value: summary?.failed.total },
  ] as const;

  return (
    <section className={s.tiles} aria-label={t("agentActivity.tile.summaryLabel")}>
      <div className={s.tile}>
        <span className={s.tileValue}>{num(summary?.actionsToday)}</span>
        <span className={s.tileLabel}>{t("agentActivity.tile.actions")}</span>
      </div>
      {pressable.map((tile) => {
        const bucket = TILE_BUCKET[tile.key];
        const pressed = filters.bucket === bucket;
        return (
          <button
            key={tile.key}
            type="button"
            className={s.tile + " " + s.tileButton + (pressed ? " " + s.tilePressed : "")}
            aria-pressed={pressed}
            onClick={() => onBucket(bucket)}
          >
            <span className={s.tileValue}>{num(tile.value)}</span>
            <span className={s.tileLabel}>{tile.label}</span>
            {tile.key === "failed" && summary ? (
              <span className={s.tileSub}>
                {t("agentActivity.tile.failedSplit", {
                  retryable: summary.failed.retryable,
                  unknown: summary.failed.unknownOutcome,
                })}
              </span>
            ) : null}
          </button>
        );
      })}
      <div className={s.tile} title={t("agentActivity.tile.publishedHint")}>
        <span className={s.tileValue}>{num(summary?.publishedToday)}</span>
        <span className={s.tileLabel}>{t("agentActivity.tile.published")}</span>
      </div>
    </section>
  );
}
