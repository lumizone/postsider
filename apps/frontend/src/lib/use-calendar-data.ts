"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCalendarPosts,
  fetchPostsList,
  type BackendPost,
} from "./posts";
import type { CalendarEvent, PostStatus } from "./calendar-data";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusFromBackend(state: BackendPost["state"]): PostStatus {
  switch (state) {
    case "PUBLISHED":
      return "published";
    case "ERROR":
      return "failed";
    case "DRAFT":
      return "draft";
    case "QUEUE":
    default:
      return "scheduled";
  }
}

export function backendPostToEvent(p: BackendPost): CalendarEvent {
  const date = new Date(p.publishDate);
  const status = statusFromBackend(p.state);
  // Drafts on the backend still carry a publishDate (defaulted at create
  // time). For UI purposes we want them to surface in the Posts page
  // without a date, mirroring the original demo shape.
  const isDraft = status === "draft";
  const firstLine =
    p.content?.split("\n").find((line) => line.trim().length > 0)?.trim() ??
    "Untitled";
  return {
    id: p.id,
    channelId: p.integration.id,
    date: isDraft ? "" : ymd(date),
    time: isDraft ? "" : hm(date),
    durationMinutes: 30,
    title: firstLine.slice(0, 80) || "Untitled",
    excerpt: p.content?.slice(0, 140),
    published: status === "published",
    status,
    group: p.group,
    metrics: undefined,
  };
}

interface UseCalendarDataOptions {
  /** Year to anchor the calendar grid to (used for the visible range). */
  year: number;
  /** 0-indexed month. */
  month: number;
}

export interface UseCalendarDataState {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setEvents: (next: CalendarEvent[]) => void;
}

/**
 * Loads posts in a window that covers the visible month plus its surrounding
 * weeks (the calendar grid renders 6 weeks). We also fetch all drafts
 * separately because /posts is keyed on publishDate and could miss drafts.
 */
export function useCalendarData({ year, month }: UseCalendarDataOptions): UseCalendarDataState {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Window: 2 weeks before the 1st of the visible month and 6 weeks after.
  const range = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(start.getDate() - 14);
    start.setHours(0, 0, 0, 0);
    const end = new Date(first);
    end.setDate(end.getDate() + 50);
    end.setHours(23, 59, 59, 999);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }, [year, month]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [calendarPosts, draftsResp] = await Promise.all([
        fetchCalendarPosts(range.startDate, range.endDate),
        fetchPostsList({ state: "draft", page: 0, limit: 100 }).catch(() => ({
          posts: [],
        })),
      ]);
      const drafts = (draftsResp as { posts: BackendPost[] }).posts || [];
      const seen = new Set<string>();
      const merged: CalendarEvent[] = [];
      for (const p of calendarPosts) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        merged.push(backendPostToEvent(p));
      }
      for (const p of drafts) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        merged.push(backendPostToEvent(p));
      }
      setEvents(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load posts");
    } finally {
      setLoading(false);
    }
  }, [range.startDate, range.endDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { events, loading, error, refresh, setEvents };
}
