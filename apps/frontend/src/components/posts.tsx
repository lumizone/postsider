"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "./posts.module.css";
import { ChannelAvatar } from "./channel-avatar";
import {
  type CalendarEvent,
  type Channel,
  type PostStatus,
} from "@/lib/calendar-data";
import { useChannels } from "@/lib/use-channels";
import {
  createPost,
  fetchPostDetail,
  deletePostGroup,
  uploadMedia,
  fetchPostsList,
  duplicatePost,
  type BackendPost,
  type CreatePostInput,
} from "@/lib/posts";
import { backendPostToEvent } from "@/lib/use-calendar-data";
import { EmptyState } from "./empty-state";
import { useI18n, useT } from "@/lib/i18n";
import { toggleEvergreen, listEvergreen, getEvergreenSettings } from "@/lib/evergreen-api";
import { requestApproval, getApprovalByPost } from "@/lib/approval-api";
import { PostDetailDrawer } from "./post-detail-drawer";
import { PostMediaThumb } from "./post-media-thumb";
import { ConfirmDialog } from "./confirm-dialog";
import {
  CreatePostModal,
  type NewPostInput,
  type InitialPostValue,
  type AttachedMedia,
} from "./create-post-modal";

type StatusFilter = "all" | PostStatus;

/** Date windows offered next to the status tabs. */
type RangePreset =
  | "all"
  | "next7"
  | "next30"
  | "last7"
  | "last30"
  | "thisMonth"
  | "custom";

type SortMode = "publishedFirst" | "smart" | "newest" | "oldest";

const STATUS_LABEL_KEYS: Record<PostStatus, string> = {
  draft: "posts.status.draft",
  pendingApproval: "posts.status.pendingApproval",
  scheduled: "posts.status.scheduled",
  published: "posts.status.published",
  failed: "posts.status.error",
  held: "posts.status.held",
};

function deriveStatus(ev: CalendarEvent): PostStatus {
  if (ev.status) return ev.status;
  if (ev.published) return "published";
  if (!ev.date) return "draft";
  return "scheduled";
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y) return null;
  return new Date(y, m - 1, d);
}

function formatDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function relativeFromNow(d: Date, t: ReturnType<typeof useT>): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (target.getTime() - now.getTime()) / 86_400_000,
  );
  if (diff === 0) return t("posts.today");
  if (diff === 1) return t("posts.tomorrow");
  if (diff === -1) return t("posts.yesterday");
  if (diff > 0) return t("posts.inDays", { n: diff });
  return t("posts.daysAgo", { n: Math.abs(diff) });
}

/**
 * Inclusive local-day bounds for a date preset. `null` on either side means
 * "unbounded in that direction", so "all" filters nothing out.
 *
 * Everything is compared at local midnight because a post's `date` is a plain
 * calendar day (`YYYY-MM-DD`), not an instant.
 */
function rangeBounds(
  preset: RangePreset,
  from: string,
  to: string,
): { start: Date | null; end: Date | null } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const shifted = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d;
  };
  switch (preset) {
    case "next7":
      return { start: today, end: shifted(7) };
    case "next30":
      return { start: today, end: shifted(30) };
    case "last7":
      return { start: shifted(-7), end: today };
    case "last30":
      return { start: shifted(-30), end: today };
    case "thisMonth":
      return {
        start: new Date(today.getFullYear(), today.getMonth(), 1),
        end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
      };
    case "custom":
      return { start: from ? parseDate(from) : null, end: to ? parseDate(to) : null };
    default:
      return { start: null, end: null };
  }
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Remove the backend-only `__type` discriminator from a settings object. */
function stripDiscriminator(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const { __type, ...rest } = settings ?? {};
  void __type;
  return rest;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle
        cx="7.25"
        cy="7.25"
        r="4.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="m10.5 10.5 3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <path
        d="M3 6.5V6a2.5 2.5 0 0 1 2.5-2.5H12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m10 1.5 2 2-2 2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 9.5v.5a2.5 2.5 0 0 1-2.5 2.5H4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m6 14.5-2-2 2-2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Posts() {
  const router = useRouter();
  const t = useT();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [range, setRange] = useState<RangePreset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortMode>("publishedFirst");
  const { channels } = useChannels();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [listTruncated, setListTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [evergreenGroups, setEvergreenGroups] = useState<Set<string>>(new Set());
  const [evergreenOrgEnabled, setEvergreenOrgEnabled] = useState(true);
  const [detailPost, setDetailPost] = useState<{ id: string; status: PostStatus } | null>(null);
  // Editing an existing post from the list: prefilled composer + group to update.
  const [editPost, setEditPost] = useState<{
    group: string;
    initial: InitialPostValue;
    approvalStatus?: "pending" | "approved" | "rejected" | "none";
    rejectionNote?: string;
  } | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Load which post groups are evergreen so each row's toggle shows the real state.
  useEffect(() => {
    let cancelled = false;
    listEvergreen()
      .then((rows) => {
        if (!cancelled) setEvergreenGroups(new Set(rows.map((r) => r.group)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // Marking a post evergreen does nothing unless the org-level switch
  // (Settings -> Evergreen) is also on — surfaced as a toast on toggle
  // below instead of leaving that discoverable only after a month of
  // silence.
  useEffect(() => {
    let cancelled = false;
    getEvergreenSettings()
      .then((s) => {
        if (!cancelled) setEvergreenOrgEnabled(s.enabled);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const channelsById = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of channels) m.set(c.id, c);
    return m;
  }, [channels]);

  // Pull posts in pages of 100 across all states. The Posts page is meant
  // to be a single scrollable list of "every post you have", so we fetch
  // all states and rely on local filtering (the backend doesn't allow
  // mixed-state queries today).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const states: ("all" | "scheduled" | "draft" | "published" | "failed" | "approval")[] = [
          "scheduled",
          "draft",
          "published",
          "failed",
          "approval",
        ];
        const collected: BackendPost[] = [];
        let truncated = false;
        for (const state of states) {
          let page = 0;
          // Cap at 5 pages (500 posts) per state — reasonable for a UI list.
          for (let i = 0; i < 5; i++) {
            const res = await fetchPostsList({
              page,
              limit: 100,
              state,
            });
            collected.push(...((res.posts as unknown) as BackendPost[]));
            if (!res.hasMore) break;
            if (i === 4) truncated = true;
            page += 1;
          }
        }
        if (!cancelled) {
          setEvents(collected.map(backendPostToEvent));
          setListTruncated(truncated);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load posts");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allWithStatus = useMemo(() => {
    return events.map((ev) => ({ ev, status: deriveStatus(ev) }));
  }, [events]);

  const bounds = useMemo(() => rangeBounds(range, from, to), [range, from, to]);

  /**
   * Everything except the status tabs: search, channel and date window. Kept
   * separate so the tab counts describe the set the tabs actually switch
   * between - a count of "12 published" is a lie if the date filter above it
   * only leaves 3.
   */
  const preStatus = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allWithStatus.filter(({ ev }) => {
      if (channelFilter !== "all" && ev.channelId !== channelFilter) return false;
      if (bounds.start || bounds.end) {
        const d = parseDate(ev.date);
        // An undated draft cannot satisfy a date window, so it drops out of
        // the list rather than being shown as if it matched.
        if (!d) return false;
        if (bounds.start && d.getTime() < bounds.start.getTime()) return false;
        if (bounds.end && d.getTime() > bounds.end.getTime()) return false;
      }
      if (!q) return true;
      const ch = channelsById.get(ev.channelId);
      const haystack = `${ev.title} ${ev.excerpt ?? ""} ${ch?.name ?? ""} ${ch?.platform ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [allWithStatus, bounds, channelFilter, channelsById, query]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: preStatus.length,
      draft: 0,
      pendingApproval: 0,
      scheduled: 0,
      published: 0,
      failed: 0,
      held: 0,
    };
    for (const { status } of preStatus) c[status] += 1;
    return c;
  }, [preStatus]);

  const items = useMemo(() => {
    // "Needs attention first": what is broken or waiting on a human, then what
    // is still going out, then what already went out.
    const STATUS_ORDER: Record<PostStatus, number> = {
      failed: 0,
      pendingApproval: 1,
      held: 2,
      scheduled: 3,
      draft: 4,
      published: 5,
    };
    // Default view: what actually went live, newest at the top. The rest keeps
    // the needs-attention ordering underneath it.
    const PUBLISHED_FIRST_ORDER: Record<PostStatus, number> = {
      published: 0,
      failed: 1,
      pendingApproval: 2,
      held: 3,
      scheduled: 4,
      draft: 5,
    };
    const byDate = (a: typeof preStatus[number], b: typeof preStatus[number]) => {
      const aDate = parseDate(a.ev.date)?.getTime() ?? 0;
      const bDate = parseDate(b.ev.date)?.getTime() ?? 0;
      // Undated posts sink to the bottom whichever way the sort runs - they
      // have no position on a timeline.
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return sort === "oldest" ? aDate - bDate : bDate - aDate;
    };
    return preStatus
      .filter(({ status }) => filter === "all" || status === filter)
      .sort((a, b) => {
        if (sort === "newest" || sort === "oldest") return byDate(a, b);
        const order =
          sort === "smart" ? STATUS_ORDER : PUBLISHED_FIRST_ORDER;
        const orderDelta = order[a.status] - order[b.status];
        if (orderDelta !== 0) return orderDelta;
        const aDate = parseDate(a.ev.date)?.getTime() ?? 0;
        const bDate = parseDate(b.ev.date)?.getTime() ?? 0;
        // Within a status: scheduled reads best soonest-first (what goes out
        // next), everything else newest-first.
        if (a.status === "scheduled") return aDate - bDate;
        return bDate - aDate;
      });
  }, [preStatus, filter, sort]);

  const filtersActive =
    filter !== "all" ||
    channelFilter !== "all" ||
    range !== "all" ||
    query.trim() !== "";

  const resetFilters = useCallback(() => {
    setFilter("all");
    setChannelFilter("all");
    setRange("all");
    setFrom("");
    setTo("");
    setQuery("");
  }, []);

  const handleRequestApproval = useCallback(async (postId: string) => {
    try {
      await requestApproval(postId);
      setEvents((current) => current.filter((event) => event.id !== postId));
      setToast(t("posts.toastApprovalSent"));
    } catch (err) {
      setToast(err instanceof Error ? err.message : t("posts.toastApprovalError"));
    }
    setTimeout(() => setToast(null), 3000);
  }, [t]);

  const handleDuplicate = useCallback(
    async (group: string, targetIntegrationId?: string) => {
      try {
        await duplicatePost(group, targetIntegrationId ? { targetIntegrationId } : undefined);
        setToast(targetIntegrationId ? t("posts.toastDuplicatedTo") : t("posts.toastDuplicatedDraft"));
        setTimeout(() => setToast(null), 3000);
        // Refresh the list
        setLoading(true);
        const states: ("all" | "scheduled" | "draft" | "published" | "failed" | "approval")[] = [
          "scheduled",
          "draft",
          "published",
          "failed",
          "approval",
        ];
        const collected: BackendPost[] = [];
        let truncated = false;
        for (const state of states) {
          let page = 0;
          for (let i = 0; i < 5; i++) {
            const res = await fetchPostsList({ page, limit: 100, state });
            collected.push(...((res.posts as unknown) as BackendPost[]));
            if (!res.hasMore) break;
            if (i === 4) truncated = true;
            page += 1;
          }
        }
        setEvents(collected.map(backendPostToEvent));
        setListTruncated(truncated);
      } catch (err) {
        setToast(t("posts.toastDuplicateFailed"));
        setTimeout(() => setToast(null), 3000);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const [duplicateTargetGroup, setDuplicateTargetGroup] = useState<string | null>(null);

  /**
   * Open the composer in edit mode for a post, prefilled with its content,
   * thread parts, media and provider settings. Mirrors the calendar flow so
   * clicking a row in the Posts list gives the same preview+edit experience.
   */
  const openEventForEdit = async (ev: CalendarEvent) => {
    if (editLoading) return;
    setEditLoading(true);
    try {
      const detail = await fetchPostDetail(ev.id);
      const [main, ...rest] = detail.posts;
      const channelId = detail.integration || ev.channelId;
      const when = detail.publishDate
        ? new Date(detail.publishDate)
        : new Date(`${ev.date}T${ev.time || "09:00"}:00`);
      const initial: InitialPostValue = {
        channelIds: channelId ? [channelId] : [],
        date: iso(when),
        time: `${String(when.getHours()).padStart(2, "0")}:${String(
          when.getMinutes(),
        ).padStart(2, "0")}`,
        body: main?.content ?? "",
        threadParts: rest.map((p) => p.content),
        perChannelSettings:
          channelId && detail.settings
            ? { [channelId]: stripDiscriminator(detail.settings) }
            : {},
        media: (main?.image ?? []).map(
          (m, idx): AttachedMedia => ({
            id: m.id ?? `existing-${idx}-${ev.id}`,
            backendId: m.id,
            name: m.url.split("/").pop()?.split("?")[0] || "attachment",
            kind: m.kind,
            size: 0,
            url: m.url,
          }),
        ),
      };
      let approvalStatus: "pending" | "approved" | "rejected" | "none" = "none";
      let rejectionNote: string | undefined;
      try {
        const approval = await getApprovalByPost(ev.id);
        if (approval?.status === "REJECTED") {
          approvalStatus = "rejected";
          rejectionNote = approval.note ?? undefined;
        } else if (approval?.status === "PENDING") {
          approvalStatus = "pending";
        }
      } catch {
        // No approval record → not an approval-tracked post, fine.
      }
      setEditPost({ group: detail.group, initial, approvalStatus, rejectionNote });
    } catch (err) {
      console.error("[edit-post]", err);
      setToast(t("errors.postEdit"));
    } finally {
      setEditLoading(false);
    }
  };

  /**
   * Submit an edit payload. Media already existing server-side (backendId)
   * rides along as {id, path} instead of being re-uploaded.
   */
  const submitEdit = async (
    post: NewPostInput,
    type: "schedule" | "draft" | "now" | "update",
    group?: string,
  ): Promise<Array<{ postId: string; integration: string }>> => {
    const isoDate = (() => {
      if (post.date && post.time) {
        const dt = new Date(`${post.date}T${post.time}:00`);
        return dt.toISOString();
      }
      return new Date().toISOString();
    })();
    const uploadedMedia: { id?: string; path: string }[] = [];
    for (const m of post.media) {
      if (m.backendId) {
        uploadedMedia.push({ id: m.backendId, path: m.url });
        continue;
      }
      const blob = await fetch(m.url).then((r) => r.blob());
      const result = await uploadMedia(blob, m.name);
      uploadedMedia.push(result);
    }
    const input: CreatePostInput = {
      type,
      date: isoDate,
      channelIds: post.channelIds,
      body: post.body,
      perChannelBody: post.perChannelBody,
      threadParts: post.threadParts,
      firstComment: post.firstComment,
      media: uploadedMedia.map((m) => ({ id: m.id ?? "", path: m.path })),
      shortLink: false,
      tags: [],
      perChannelSettings: post.perChannelSettings,
      ...(group ? { group } : {}),
    };
    return await createPost(input);
  };

  const refreshList = async () => {
    setLoading(true);
    try {
        const states: ("all" | "scheduled" | "draft" | "published" | "failed" | "approval" | "held")[] = [
          "scheduled",
          "draft",
          "published",
          "failed",
          "approval",
          "held",
        ];
      const collected: BackendPost[] = [];
      let truncated = false;
      for (const state of states) {
        let page = 0;
        for (let i = 0; i < 5; i++) {
          const res = await fetchPostsList({ page, limit: 100, state });
          collected.push(...((res.posts as unknown) as BackendPost[]));
          if (!res.hasMore) break;
          if (i === 4) truncated = true;
          page += 1;
        }
      }
      setEvents(collected.map(backendPostToEvent));
      setListTruncated(truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load posts");
    } finally {
      setLoading(false);
    }
  };

  const runDelete = async () => {
    if (!confirmDelete) return;
    setConfirmBusy(true);
    try {
      await deletePostGroup(confirmDelete);
      setConfirmDelete(null);
      await refreshList();
    } catch (err) {
      setToast(t("errors.postDelete"));
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <section className={styles.root}>
      {toast && <div className={styles.toast}>{toast}</div>}
      {duplicateTargetGroup && (
        <DuplicateChannelPicker
          channels={channels}
          onPick={(channelId) => {
            void handleDuplicate(duplicateTargetGroup, channelId);
            setDuplicateTargetGroup(null);
          }}
          onClose={() => setDuplicateTargetGroup(null)}
        />
      )}
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.eyebrow}>{t("posts.eyebrow")}</span>
          <h1 className={styles.h1}>{t("posts.title")}</h1>
          <p className={styles.subtitle}>
            {t("posts.subtitle")}
          </p>
        </div>
        <div className={styles.headerControls}>
          <button
            type="button"
            className={styles.importBtn}
            onClick={() => router.push("/posts/csv-import")}
          >
            {t("posts.importCsv")}
          </button>
          <button type="button" className={styles.newBtn} onClick={() => router.push("/calendar")}>
            + {t("posts.newPost")}
          </button>
        </div>
      </header>

      <div className={styles.filters}>
        <div className={styles.tabs} role="tablist" aria-label={t("posts.statusFilter")}>
          {(["all", "scheduled", "draft", "published", "failed", "pendingApproval", "held"] as StatusFilter[]).map(
            (f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={
                  styles.tab + (filter === f ? " " + styles.tabActive : "")
                }
                onClick={() => setFilter(f)}
              >
                {f === "all" ? t("posts.all") : t(STATUS_LABEL_KEYS[f] as any)}
                <span className={styles.tabCount}>{counts[f]}</span>
              </button>
            ),
          )}
        </div>

        <div className={styles.filterRow}>
          <div className={styles.search}>
            <span className={styles.searchIcon} aria-hidden>
              <SearchIcon />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("posts.search")}
              className={styles.searchInput}
              aria-label={t("posts.search")}
            />
          </div>

          <select
            className={styles.select}
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            aria-label={t("posts.filterChannel")}
          >
            <option value="all">{t("posts.allChannels")}</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.platform}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={range}
            onChange={(e) => setRange(e.target.value as RangePreset)}
            aria-label={t("posts.filterDate")}
          >
            <option value="all">{t("posts.dateAll")}</option>
            <option value="next7">{t("posts.dateNext7")}</option>
            <option value="next30">{t("posts.dateNext30")}</option>
            <option value="last7">{t("posts.dateLast7")}</option>
            <option value="last30">{t("posts.dateLast30")}</option>
            <option value="thisMonth">{t("posts.dateThisMonth")}</option>
            <option value="custom">{t("posts.dateCustom")}</option>
          </select>

          {range === "custom" && (
            <>
              <input
                type="date"
                className={styles.dateInput}
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                aria-label={t("posts.dateFrom")}
              />
              <input
                type="date"
                className={styles.dateInput}
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                aria-label={t("posts.dateTo")}
              />
            </>
          )}

          <select
            className={styles.select}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            aria-label={t("posts.sort")}
          >
            <option value="publishedFirst">{t("posts.sortPublishedFirst")}</option>
            <option value="smart">{t("posts.sortSmart")}</option>
            <option value="newest">{t("posts.sortNewest")}</option>
            <option value="oldest">{t("posts.sortOldest")}</option>
          </select>

          {filtersActive && (
            <button type="button" className={styles.resetBtn} onClick={resetFilters}>
              {t("posts.resetFilters")}
            </button>
          )}

          <span className={styles.resultCount} role="status">
            {t("posts.resultCount", { n: items.length })}
          </span>
        </div>
      </div>
      {listTruncated && (
        <div role="status" style={{ margin: "12px 0", padding: "10px 12px", borderRadius: 8, background: "rgb(var(--tint) / 0.04)", color: "var(--muted)", fontSize: 12 }}>
          {t("posts.listTruncated")}
        </div>
      )}

      {loading ? (
        <div className={styles.empty}>{t("common.loading")}</div>
      ) : error ? (
        <div className={styles.empty}>
          <p>{error}</p>
          <button type="button" className={styles.importBtn} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            {t("calendar.retry")}
          </button>
        </div>
      ) : items.length === 0 && events.length > 0 ? (
        // There ARE posts, the filters just exclude all of them. Saying "no
        // posts yet" here would read as data loss.
        <EmptyState
          icon="posts"
          title={t("posts.emptyFiltered")}
          description={t("posts.emptyFilteredDesc")}
          actionLabel={t("posts.resetFilters")}
          onAction={resetFilters}
        />
      ) : items.length === 0 && channels.length === 0 ? (
        <EmptyState
          icon="channel"
          title={t("empty.channelTitle")}
          description={t("empty.channelDescAdmin")}
          actionLabel={t("empty.channelAction")}
          // Settings > General has no channel UI at all, so the old target was
          // a dead end for the one action this empty state exists to prompt.
          // ?connect=1 opens the calendar's real add-channel picker.
          actionHref="/calendar?connect=1"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="posts"
          title={t("posts.emptyAll")}
          description={t("posts.emptyAllDesc")}
          actionLabel="Open calendar"
          actionHref="/calendar"
        />
      ) : (
        <div className={styles.list} role="list">
          {items.map(({ ev, status }) => (
            <PostRow
              key={ev.id}
              ev={ev}
              status={status}
              channel={channelsById.get(ev.channelId)}
              onOpenEdit={() => void openEventForEdit(ev)}
              onDuplicate={() => void handleDuplicate(ev.group)}
              onDuplicateTo={() => setDuplicateTargetGroup(ev.group)}
              onRequestApproval={() => void handleRequestApproval(ev.id)}
              onViewDetails={() => setDetailPost({ id: ev.id, status })}
              initialEvergreen={evergreenGroups.has(ev.group)}
              evergreenOrgEnabled={evergreenOrgEnabled}
              onEvergreenOrgDisabledWarning={() => setToast(t("evergreen.orgDisabledWarning"))}
            />
          ))}
        </div>
      )}

      {detailPost && (
        <PostDetailDrawer
          postId={detailPost.id}
          status={detailPost.status}
          onClose={() => setDetailPost(null)}
        />
      )}

      {editPost && (
        <CreatePostModal
          channels={channels}
          date={editPost.initial.date}
          time={editPost.initial.time}
          initialValue={editPost.initial}
          onClose={() => setEditPost(null)}
          onSaveDraft={() => setEditPost(null)}
          onSchedule={async (post) => {
            await submitEdit(post, "update", editPost.group);
            setEditPost(null);
            void refreshList();
          }}
          onPublishNow={async (post) => {
            await submitEdit(post, "now", editPost.group);
            setEditPost(null);
            void refreshList();
          }}
          onSendToApproval={
            editPost.approvalStatus === "rejected"
              ? async (post) => {
                  await submitEdit(post, "update", editPost.group);
                  for (const c of (await submitEdit(post, "draft", editPost.group)) ?? []) {
                    await requestApproval(c.postId);
                  }
                  setEditPost(null);
                  void refreshList();
                }
              : undefined
          }
          onDelete={async () => {
            const group = editPost.group;
            setEditPost(null);
            setConfirmDelete(group);
          }}
          approvalStatus={editPost.approvalStatus}
          rejectionNote={editPost.rejectionNote}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          danger
          busy={confirmBusy}
          title={t("posts.deleteConfirmTitle")}
          body={t("posts.deleteConfirmBody")}
          confirmLabel={t("posts.deleteBtn")}
          onConfirm={() => void runDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}

interface PostRowProps {
  ev: CalendarEvent;
  status: PostStatus;
  channel?: Channel;
  onOpenEdit: () => void;
  onDuplicate: () => void;
  onDuplicateTo: () => void;
  onRequestApproval: () => void;
  onViewDetails: () => void;
  initialEvergreen?: boolean;
  evergreenOrgEnabled?: boolean;
  onEvergreenOrgDisabledWarning?: () => void;
}

function PostRow({ ev, status, channel, onOpenEdit, onDuplicate, onDuplicateTo, onRequestApproval, onViewDetails, initialEvergreen, evergreenOrgEnabled, onEvergreenOrgDisabledWarning }: PostRowProps) {
  const date = parseDate(ev.date);
  const [menuOpen, setMenuOpen] = useState(false);
  const [evergreenOn, setEvergreenOn] = useState<boolean>(initialEvergreen ?? false);
  const { t, locale } = useI18n();

  // Reflect the evergreen state once the parent's async fetch resolves.
  useEffect(() => {
    if (initialEvergreen !== undefined) setEvergreenOn(initialEvergreen);
  }, [initialEvergreen]);

  const onToggleEvergreen = () => {
    const next = !evergreenOn;
    setEvergreenOn(next); // optimistic
    void toggleEvergreen(ev.group, next).catch(() => setEvergreenOn(!next));
    if (next && evergreenOrgEnabled === false) onEvergreenOrgDisabledWarning?.();
  };

  const statusClass = `statusPill${status[0].toUpperCase()}${status.slice(1)}`;

  return (
    <div
      className={styles.row}
      role="listitem"
      tabIndex={0}
      onClick={onOpenEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenEdit();
        }
      }}
    >
      <div className={styles.statusCell}>
        <span
          className={
            styles.statusPill +
            " " +
            (styles[statusClass as keyof typeof styles] as string)
          }
        >
          <span className={styles.statusDot} aria-hidden />
          {t(STATUS_LABEL_KEYS[status] as any)}
        </span>
      </div>

      <div className={styles.titleCell}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <PostMediaThumb media={ev.media} size={26} />
          <span className={styles.postTitle}>{ev.title}</span>
        </div>
        {ev.excerpt && <span className={styles.excerpt}>{ev.excerpt}</span>}
      </div>

      <div className={styles.channelCell}>
        {channel ? (
          <>
            <ChannelAvatar channel={channel} size={26} radius={7} />
            <span className={styles.channelMain}>
              <span className={styles.channelName}>{channel.name}</span>
              <span className={styles.channelPlatform}>{channel.platform}</span>
            </span>
          </>
        ) : (
          <span className={styles.muted}>{t("posts.unassigned")}</span>
        )}
      </div>

      <div className={styles.dateCell}>
        {date ? (
          <>
            <span className={styles.dateMain}>{formatDate(date, locale)}</span>
            <span className={styles.dateSub}>
              {ev.time ? ev.time + " · " : ""}
              {relativeFromNow(date, t)}
            </span>
          </>
        ) : (
          <span className={styles.muted}>{t("posts.noDate")}</span>
        )}
      </div>

      <div
        className={
          styles.metricsCell +
          // The "-" placeholder keeps the column rhythm on the desktop table.
          // In the phone card layout there is no column to keep, so it reads
          // as a stray dash and is hidden.
          (status === "published" && ev.metrics ? "" : " " + styles.metricsEmpty)
        }
      >
        {status === "published" && ev.metrics ? (
          <>
            <span className={styles.metricsMain}>
              {compactNumber(ev.metrics.impressions)}
            </span>
            <span className={styles.metricsSub}>
              {compactNumber(ev.metrics.engagements)} {t("posts.engShort")}
            </span>
          </>
        ) : (
          <span className={styles.muted}>-</span>
        )}
      </div>

      <div className={styles.actionsCell}>
        <button
          type="button"
          className={styles.moreBtn}
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          aria-label="Post actions"
        >
          <DotsIcon />
        </button>
        {menuOpen && (
          <div className={styles.menu} onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} role="menu">
            <button type="button" className={styles.menuItem} onClick={(e) => { e.stopPropagation(); onViewDetails(); }} role="menuitem">
              {t("postDetail.viewDetails")}
            </button>
            <button type="button" className={styles.menuItem} onClick={(e) => { e.stopPropagation(); onDuplicate(); }} role="menuitem">
              {t("posts.duplicate")}
            </button>
            <button type="button" className={styles.menuItem} onClick={(e) => { e.stopPropagation(); onDuplicateTo(); }} role="menuitem">
              {t("posts.duplicateTo")}
            </button>
            <button type="button" className={styles.menuItem} onClick={(e) => { e.stopPropagation(); onToggleEvergreen(); }} role="menuitem">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <RepeatIcon />
                {evergreenOn ? t("evergreen.unmarkEvergreen") : t("evergreen.markEvergreen")}
              </span>
            </button>
            {status === "draft" && (
              <button type="button" className={styles.menuItem} onClick={(e) => { e.stopPropagation(); onRequestApproval(); }} role="menuitem">
                {t("approval.requestBtn")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function DuplicateChannelPicker({
  channels,
  onPick,
  onClose,
}: {
  channels: Channel[];
  onPick: (channelId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.pickerBackdrop} onClick={onClose}>
      <div
        className={styles.pickerModal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("posts.duplicateToTitle")}
      >
        <div className={styles.pickerHead}>
          <span className={styles.pickerTitle}>{t("posts.duplicateToTitle")}</span>
          <button type="button" className={styles.pickerClose} onClick={onClose} aria-label={t("common.close")}>×</button>
        </div>
        <div className={styles.pickerList}>
          {channels.map((ch) => (
            <button
              key={ch.id}
              type="button"
              className={styles.pickerItem}
              onClick={() => onPick(ch.id)}
            >
              <ChannelAvatar channel={ch} size={28} radius={7} />
              <span className={styles.pickerItemText}>
                <span className={styles.pickerItemName}>{ch.name}</span>
                <span className={styles.pickerItemPlatform}>{ch.platform}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
