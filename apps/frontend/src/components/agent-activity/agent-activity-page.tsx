"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import { listChannels } from "@/lib/integrations";
import type { AgentGroup } from "@/lib/agent-activity-api";
import {
  filtersFromSearch,
  filtersToSearch,
  hasActiveFilters,
  type AgentFilters,
} from "@/lib/agent-activity-filters";
import { pruneSelection, toggleGroup } from "@/lib/agent-activity-model";
import { AgentFiltersBar, type ChannelOption } from "./agent-filters";
import { AgentGroupRow } from "./agent-group-row";
import { AgentSummaryBar } from "./agent-summary-bar";
import { useAgentActivity } from "./use-agent-activity";
import s from "./agent-activity.module.css";

export function AgentActivityPage() {
  const t = useT();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const search = searchParams?.toString() ?? "";
  const filters = useMemo(() => filtersFromSearch(search), [search]);
  const { groups, nextCursor, summary, filterOptions, loading, loadingMore, error, loadMore, refresh } =
    useAgentActivity(filters);

  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  // Task 12 attaches the drawer to this.
  const [, setOpened] = useState<AgentGroup | null>(null);

  useEffect(() => {
    let cancelled = false;
    listChannels()
      .then((res) => {
        if (cancelled) return;
        setChannels(res.raw.map((i) => ({ id: i.id, name: i.name, identifier: i.identifier })));
      })
      .catch(() => {
        // The channel filter stays empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelection((prev) => (prev.size === 0 ? prev : pruneSelection(prev, groups)));
  }, [groups]);

  const applyFilters = useCallback(
    (next: AgentFilters) => {
      const qs = filtersToSearch(next);
      router.replace(qs ? pathname + "?" + qs : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const showEmpty = !loading && !error && groups.length === 0;

  return (
    <div className={s.page}>
      <div className={s.head}>
        <PageHeader
          eyebrow={t("agentActivity.eyebrow")}
          title={t("agentActivity.title")}
          subtitle={t("agentActivity.subtitle")}
        />
        <button type="button" className={s.ghost} onClick={refresh}>
          {t("agentActivity.list.refresh")}
        </button>
      </div>

      <AgentSummaryBar
        summary={summary}
        filters={filters}
        onBucket={(bucket) => applyFilters({ ...filters, bucket: filters.bucket === bucket ? "attention" : bucket })}
      />

      <AgentFiltersBar
        filters={filters}
        options={filterOptions}
        channels={channels}
        onChange={applyFilters}
      />

      {selection.size > 0 ? (
        <p className={s.selectedNote} aria-live="polite">
          {t("agentActivity.list.selected", { count: selection.size })}
        </p>
      ) : null}

      {error ? (
        <div role="alert" className={s.errorBanner}>
          <span>{t("agentActivity.list.loadError")}</span>
          <button type="button" className={s.ghost} onClick={refresh}>
            {t("agentActivity.list.retry")}
          </button>
        </div>
      ) : null}

      {loading ? (
        <ul className={s.list} aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className={s.skeleton} aria-hidden />
          ))}
        </ul>
      ) : showEmpty ? (
        <EmptyState
          icon="analytics"
          title={t("agentActivity.list.emptyTitle")}
          description={
            hasActiveFilters(filters)
              ? t("agentActivity.list.emptyFiltered")
              : t("agentActivity.list.emptyAll")
          }
        />
      ) : (
        <ul className={s.list}>
          {groups.map((g) => (
            <AgentGroupRow
              key={g.group}
              group={g}
              selectable={isAdmin && g.pendingApprovalIds.length > 0}
              selected={selection.has(g.group)}
              onToggle={(id) => setSelection((prev) => toggleGroup(prev, id))}
              onOpen={setOpened}
            />
          ))}
        </ul>
      )}

      {nextCursor && !loading ? (
        <div className={s.more}>
          <button type="button" className={s.ghost} onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t("agentActivity.list.loadingMore") : t("agentActivity.list.loadMore")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
