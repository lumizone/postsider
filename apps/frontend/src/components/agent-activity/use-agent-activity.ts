"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAgentFilters,
  getAgentSummary,
  listAgentActivity,
  type AgentFilterOptions,
  type AgentGroup,
  type AgentSummary,
} from "@/lib/agent-activity-api";
import { toApiQuery, type AgentFilters } from "@/lib/agent-activity-filters";
import { mergeGroupPages } from "@/lib/agent-activity-model";

const PAGE_SIZE = 25;

function localTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export interface UseAgentActivity {
  groups: AgentGroup[];
  nextCursor: string | null;
  summary: AgentSummary | null;
  filterOptions: AgentFilterOptions | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Loads the list, the summary and the filter options. Every response is tied
 * to the request generation that started it, so a slow answer for old filters
 * can never overwrite a newer one. Refetches when the window regains focus.
 */
export function useAgentActivity(filters: AgentFilters): UseAgentActivity {
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [filterOptions, setFilterOptions] = useState<AgentFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Stable key: only a real filter change restarts the list.
  const key = useMemo(() => JSON.stringify(toApiQuery(filters, PAGE_SIZE)), [filters]);
  const generation = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    const mine = ++generation.current;
    let cancelled = false;
    const live = () => !cancelled && generation.current === mine;
    // A first load or a filter change shows the skeleton; a refresh keeps the rows.
    if (loadedKey.current !== key) {
      setLoading(true);
      setGroups([]);
      setNextCursor(null);
      cursorRef.current = null;
    }
    setError(null);
    loadingMoreRef.current = false;
    setLoadingMore(false);

    const query = JSON.parse(key) as Record<string, string>;
    listAgentActivity(query)
      .then((res) => {
        if (!live()) return;
        setGroups(res.groups);
        setNextCursor(res.nextCursor);
        cursorRef.current = res.nextCursor;
        loadedKey.current = key;
      })
      .catch((e: unknown) => {
        if (!live()) return;
        setError(e instanceof Error ? e.message : "error");
      })
      .finally(() => {
        if (live()) setLoading(false);
      });

    getAgentSummary(localTimezone())
      .then((s) => {
        if (live()) setSummary(s);
      })
      .catch(() => {
        // The tiles stay empty; the list reports its own error.
      });

    return () => {
      cancelled = true;
    };
  }, [key, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    getAgentFilters()
      .then((o) => {
        if (!cancelled) setFilterOptions(o);
      })
      .catch(() => {
        // Filters fall back to "Any" only.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  useEffect(() => {
    const onFocus = () => setRefreshTick((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const mine = generation.current;
    const query = { ...(JSON.parse(key) as Record<string, string>), cursor };
    listAgentActivity(query)
      .then((res) => {
        if (generation.current !== mine) return;
        setGroups((prev) => mergeGroupPages(prev, res.groups));
        setNextCursor(res.nextCursor);
        cursorRef.current = res.nextCursor;
      })
      .catch((e: unknown) => {
        if (generation.current !== mine) return;
        setError(e instanceof Error ? e.message : "error");
      })
      .finally(() => {
        if (generation.current !== mine) return;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [key]);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  return { groups, nextCursor, summary, filterOptions, loading, loadingMore, error, loadMore, refresh };
}
