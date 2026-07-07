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
import { fetchPostsList, duplicatePost, type BackendPost } from "@/lib/posts";
import { backendPostToEvent } from "@/lib/use-calendar-data";
import { EmptyState } from "./empty-state";
import { useT } from "@/lib/i18n";
import { toggleEvergreen, listEvergreen } from "@/lib/evergreen-api";
import { requestApproval } from "@/lib/approval-api";

type StatusFilter = "all" | PostStatus;

const STATUS_LABEL_KEYS: Record<PostStatus, string> = {
  draft: "posts.status.draft",
  scheduled: "posts.status.scheduled",
  published: "posts.status.published",
  failed: "posts.status.error",
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

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
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
  if (diff === 0) return t("posts.today" as any);
  if (diff === 1) return t("posts.tomorrow" as any);
  if (diff === -1) return t("posts.yesterday" as any);
  if (diff > 0) return t("posts.inDays" as any, { n: diff });
  return t("posts.daysAgo" as any, { n: Math.abs(diff) });
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
  const { channels } = useChannels();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [evergreenGroups, setEvergreenGroups] = useState<Set<string>>(new Set());

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
        const states: ("all" | "scheduled" | "draft" | "published")[] = [
          "scheduled",
          "draft",
          "published",
        ];
        const collected: BackendPost[] = [];
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
            page += 1;
          }
        }
        if (!cancelled) setEvents(collected.map(backendPostToEvent));
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

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: allWithStatus.length,
      draft: 0,
      scheduled: 0,
      published: 0,
      failed: 0,
    };
    for (const { status } of allWithStatus) c[status] += 1;
    return c;
  }, [allWithStatus]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const STATUS_ORDER: Record<PostStatus, number> = {
      failed: 0,
      scheduled: 1,
      draft: 2,
      published: 3,
    };
    return allWithStatus
      .filter(({ status }) => filter === "all" || status === filter)
      .filter(({ ev }) => {
        if (!q) return true;
        const ch = channelsById.get(ev.channelId);
        const haystack = `${ev.title} ${ev.excerpt ?? ""} ${ch?.name ?? ""} ${ch?.platform ?? ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        // Sort: failed first, then scheduled (closest first), then drafts (newest id first), then published (newest first).
        const orderDelta = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (orderDelta !== 0) return orderDelta;
        const aDate = parseDate(a.ev.date)?.getTime() ?? 0;
        const bDate = parseDate(b.ev.date)?.getTime() ?? 0;
        if (a.status === "scheduled") return aDate - bDate;
        return bDate - aDate;
      });
  }, [allWithStatus, channelsById, filter, query]);

  const handleRequestApproval = useCallback(async (postId: string) => {
    try {
      await requestApproval(postId);
      setToast(t("posts.toastApprovalSent" as any));
    } catch (err) {
      setToast(err instanceof Error ? err.message : t("posts.toastApprovalError" as any));
    }
    setTimeout(() => setToast(null), 3000);
  }, [t]);

  const handleDuplicate = useCallback(
    async (group: string, targetIntegrationId?: string) => {
      try {
        await duplicatePost(group, targetIntegrationId ? { targetIntegrationId } : undefined);
        setToast(targetIntegrationId ? t("posts.toastDuplicatedTo" as any) : t("posts.toastDuplicatedDraft" as any));
        setTimeout(() => setToast(null), 3000);
        // Refresh the list
        setLoading(true);
        const states: ("all" | "scheduled" | "draft" | "published")[] = ["scheduled", "draft", "published"];
        const collected: BackendPost[] = [];
        for (const state of states) {
          const res = await fetchPostsList({ page: 0, limit: 100, state });
          collected.push(...((res.posts as unknown) as BackendPost[]));
        }
        setEvents(collected.map(backendPostToEvent));
      } catch (err) {
        setToast(t("posts.toastDuplicateFailed" as any));
        setTimeout(() => setToast(null), 3000);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const [duplicateTargetGroup, setDuplicateTargetGroup] = useState<string | null>(null);

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
          <span className={styles.eyebrow}>{t("posts.eyebrow" as any)}</span>
          <h1 className={styles.h1}>{t("posts.title" as any)}</h1>
          <p className={styles.subtitle}>
            {t("posts.subtitle" as any)}
          </p>
        </div>
        <div className={styles.headerControls}>
          <button
            type="button"
            className={styles.importBtn}
            onClick={() => router.push("/posts/csv-import")}
          >
            {t("posts.importCsv" as any)}
          </button>
          <button type="button" className={styles.newBtn} onClick={() => router.push("/calendar")}>
            + {t("posts.newPost" as any)}
          </button>
        </div>
      </header>

      <div className={styles.filters}>
        <div className={styles.tabs} role="tablist" aria-label={t("posts.statusFilter" as any)}>
          {(["all", "scheduled", "draft", "published", "failed"] as StatusFilter[]).map(
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
                {f === "all" ? t("posts.all" as any) : t(STATUS_LABEL_KEYS[f] as any)}
                <span className={styles.tabCount}>{counts[f]}</span>
              </button>
            ),
          )}
        </div>

        <div className={styles.search}>
          <span className={styles.searchIcon} aria-hidden>
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("posts.search" as any)}
            className={styles.searchInput}
            aria-label={t("posts.search" as any)}
          />
        </div>
      </div>

      {loading ? (
        <div className={styles.empty}>{t("common.loading" as any)}</div>
      ) : error ? (
        <div className={styles.empty}>{error}</div>
      ) : items.length === 0 && channels.length === 0 ? (
        <EmptyState
          icon="channel"
          title={t("empty.channelTitle" as any)}
          description={t("empty.channelDescAdmin" as any)}
          actionLabel={t("empty.channelAction" as any)}
          actionHref="/settings/general"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="posts"
          title={t("posts.emptyAll" as any)}
          description={t("posts.emptyAllDesc" as any)}
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
              onDuplicate={() => void handleDuplicate(ev.group)}
              onDuplicateTo={() => setDuplicateTargetGroup(ev.group)}
              onRequestApproval={() => void handleRequestApproval(ev.id)}
              initialEvergreen={evergreenGroups.has(ev.group)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface PostRowProps {
  ev: CalendarEvent;
  status: PostStatus;
  channel?: Channel;
  onDuplicate: () => void;
  onDuplicateTo: () => void;
  onRequestApproval: () => void;
  initialEvergreen?: boolean;
}

function PostRow({ ev, status, channel, onDuplicate, onDuplicateTo, onRequestApproval, initialEvergreen }: PostRowProps) {
  const date = parseDate(ev.date);
  const [menuOpen, setMenuOpen] = useState(false);
  const [evergreenOn, setEvergreenOn] = useState<boolean>(initialEvergreen ?? false);
  const t = useT();

  // Reflect the evergreen state once the parent's async fetch resolves.
  useEffect(() => {
    if (initialEvergreen !== undefined) setEvergreenOn(initialEvergreen);
  }, [initialEvergreen]);

  const onToggleEvergreen = () => {
    const next = !evergreenOn;
    setEvergreenOn(next); // optimistic
    void toggleEvergreen(ev.group, next).catch(() => setEvergreenOn(!next));
  };

  const statusClass = `statusPill${status[0].toUpperCase()}${status.slice(1)}`;

  return (
    <div
      className={styles.row}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
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
        <span className={styles.postTitle}>{ev.title}</span>
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
          <span className={styles.muted}>{t("posts.unassigned" as any)}</span>
        )}
      </div>

      <div className={styles.dateCell}>
        {date ? (
          <>
            <span className={styles.dateMain}>{formatDate(date)}</span>
            <span className={styles.dateSub}>
              {ev.time ? ev.time + " · " : ""}
              {relativeFromNow(date, t)}
            </span>
          </>
        ) : (
          <span className={styles.muted}>{t("posts.noDate" as any)}</span>
        )}
      </div>

      <div className={styles.metricsCell}>
        {status === "published" && ev.metrics ? (
          <>
            <span className={styles.metricsMain}>
              {compactNumber(ev.metrics.impressions)}
            </span>
            <span className={styles.metricsSub}>
              {compactNumber(ev.metrics.engagements)} {t("posts.engShort" as any)}
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
          <div className={styles.menu} onClick={() => setMenuOpen(false)} role="menu">
            <button type="button" className={styles.menuItem} onClick={onDuplicate} role="menuitem">
              {t("posts.duplicate" as any)}
            </button>
            <button type="button" className={styles.menuItem} onClick={onDuplicateTo} role="menuitem">
              {t("posts.duplicateTo" as any)}
            </button>
            <button type="button" className={styles.menuItem} onClick={onToggleEvergreen} role="menuitem">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <RepeatIcon />
                {evergreenOn ? t("evergreen.unmarkEvergreen" as any) : t("evergreen.markEvergreen" as any)}
              </span>
            </button>
            {status === "draft" && (
              <button type="button" className={styles.menuItem} onClick={onRequestApproval} role="menuitem">
                {t("approval.requestBtn" as any)}
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
        aria-label={t("posts.duplicateToTitle" as any)}
      >
        <div className={styles.pickerHead}>
          <span className={styles.pickerTitle}>{t("posts.duplicateToTitle" as any)}</span>
          <button type="button" className={styles.pickerClose} onClick={onClose} aria-label={t("common.close" as any)}>×</button>
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
