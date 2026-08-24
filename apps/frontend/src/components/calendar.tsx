"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./calendar.module.css";
import { ChannelsPanel } from "./channels-panel";
import { PlatformIcon } from "./platform-icon";
import { ChannelDetailModal } from "./channel-detail-modal";
import { AddChannelModal } from "./add-channel-modal";
import { CustomFieldsModal } from "./custom-fields-modal";
import { TelegramConnectModal } from "./telegram-connect-modal";
import { FarcasterConnectModal } from "./farcaster-connect-modal";
import { DiscordBotChoiceModal } from "./discord-bot-choice-modal";
import { DayPopup } from "./day-popup";
import { ConfirmDialog } from "./confirm-dialog";
import { EmptyState } from "./empty-state";
import { SetupChecklist } from "./setup-checklist";
import { useI18n, useT } from "@/lib/i18n";
import {
  type CalendarEvent,
  type Channel,
  type PostStatus,
} from "@/lib/calendar-data";
import { useChannels } from "@/lib/use-channels";
import { useCalendarData } from "@/lib/use-calendar-data";
import {
  deleteChannel as deleteChannelApi,
  getOauthUrl,
  connectIntegration,
  setChannelColor as persistChannelColor,
  type CustomFieldDef,
} from "@/lib/integrations";
import {
  createPost,
  fetchPostDetail,
  deletePostGroup,
  uploadMedia,
  changePostDate,
  type CreatePostInput,
} from "@/lib/posts";
import { requestApproval, getApprovalByPost } from "@/lib/approval-api";
import {
  CreatePostModal,
  type NewPostInput,
  type InitialPostValue,
  type AttachedMedia,
} from "./create-post-modal";
import { useAuth } from "@/lib/auth-context";
import { layoutOverlappingEvents } from "@/lib/event-lanes";

/** Monday-first weekday names for the given locale (2024-01-01 is a Monday). */
function buildWeekdayNames(
  locale: string,
  format: "short" | "narrow",
): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: format });
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(2024, 0, 1 + i)),
  );
}

function buildMonthNames(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { month: "long" });
  return Array.from({ length: 12 }, (_, i) =>
    fmt.format(new Date(2024, i, 1)),
  );
}

type ViewMode = "day" | "week" | "month" | "year";

interface CalendarProps {
  year: number;
  month: number; // 0-indexed
}

interface DayCell {
  date: Date;
  inCurrentMonth: boolean;
}

const DEFAULT_DURATION = 45;

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

/**
 * Whether a calendar event can be dragged to a new date/time.
 *
 * Excludes "published" (already sent, moving it would be meaningless) and
 * "pendingApproval" — PUT /posts/:id/date accepts any non-published post
 * and sets state:QUEUE, so dragging an approval-pending post would silently
 * pull it out of review and schedule it for real publish. Everything else
 * (draft, scheduled, failed) is safe to move.
 *
 * Single source of truth for moveEvent and both drag-affordance checks below
 * — they used to disagree (moveEvent allowed drafts, the draggable attribute
 * did not), so dragging a draft was a no-op with no visible cause.
 */
function isDraggableStatus(status: PostStatus | undefined): boolean {
  return (
    !!status &&
    status !== "published" &&
    status !== "pendingApproval" &&
    // A HELD post is parked by the Emergency Pause: dragging it would try to
    // reschedule to QUEUE, which the backend rejects with 423 while paused.
    status !== "held"
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const offset = (r.getDay() + 6) % 7; // Mon-first
  r.setDate(r.getDate() - offset);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function buildMonthGrid(year: number, month: number): DayCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const leadingBlankDays = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - leadingBlankDays);
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    cells.push({ date, inCurrentMonth: date.getMonth() === month });
  }
  return cells;
}

function channelInitial(c: Channel): string {
  const parts = c.name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M10 3.5 5.5 8 10 12.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const VIEW_LABELS: Record<ViewMode, string> = {
  day: "calendar.viewDay",
  week: "calendar.viewWeek",
  month: "calendar.viewMonth",
  year: "calendar.viewYear",
};

export function Calendar({ year, month }: CalendarProps) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(new Date(year, month, 1));
  const [selected, setSelected] = useState<Date | null>(null);
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const [composer, setComposer] = useState<{ date: string; time: string } | null>(null);
  // Bumped whenever a post is created, so SetupChecklist's post-count re-fetches
  // even when the composer was opened from its own "Write a post" button (which
  // doesn't otherwise change anything the checklist was watching).
  const [postCreatedTick, setPostCreatedTick] = useState(0);
  // Editing an existing post: prefilled modal + group to update.
  const [editPost, setEditPost] = useState<{
    group: string;
    initial: InitialPostValue;
    approvalStatus?: "pending" | "approved" | "rejected" | "none";
    rejectionNote?: string;
  } | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editRetryEvent, setEditRetryEvent] = useState<CalendarEvent | null>(null);

  // Toolbar: search + status filter. Lightweight, non-destructive — the grid
  // stays mounted and just re-filters what's shown.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PostStatus>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  // Close the status-filter dropdown on outside click / Escape, matching the
  // other dropdowns in the shell (notifications bell, org switcher).
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  const { user } = useAuth();
  const isMember = user?.role === "USER";

  const {
    channels,
    raw: rawChannels,
    setChannels,
    loading: channelsLoading,
    error: channelsError,
    refresh: refreshChannels,
  } = useChannels();
  const cursorYear = cursor.getFullYear();
  const cursorMonth = cursor.getMonth();
  const {
    events,
    loading: eventsLoading,
    error: eventsError,
    refresh: refreshEvents,
    setEvents,
  } = useCalendarData({
    year: cursorYear,
    month: cursorMonth,
  });
  const loadError = eventsError || channelsError;
  // Show the loading placeholder only until the FIRST full load completes;
  // later range/view changes keep the grid mounted, so empty workspaces can
  // navigate months without the grid flashing away.
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => {
    if (!channelsLoading && !eventsLoading) setBootstrapped(true);
  }, [channelsLoading, eventsLoading]);
  const initialLoading =
    !bootstrapped && (channelsLoading || eventsLoading);

  // All channels are always visible in the calendar — the dot in the panel is a
  // colour identifier only, not a toggle.
  const enabled = useMemo(
    () => new Set(channels.map((c) => c.id)),
    [channels],
  );
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const [addChannelOpen, setAddChannelOpen] = useState(false);
  // Onboarding hands off here with ?connect=1 rather than reimplementing the
  // per-provider connect branching. Strip the param once consumed so a later
  // refresh or back-navigation doesn't reopen the picker.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("connect") !== "1") return;
    // Matches the panel's own "Add channel" button (member-gated below) —
    // without this, a member landing on the link saw a modal the rest of
    // the UI otherwise hides from that role.
    if (!isMember) setAddChannelOpen(true);
    url.searchParams.delete("connect");
    window.history.replaceState({}, "", url.pathname + url.search);
  }, [isMember]);
  const [customFieldsState, setCustomFieldsState] = useState<{
    provider: string;
    label: string;
    fields: CustomFieldDef[];
    state: string;
  } | null>(null);
  const [customFieldsSubmitting, setCustomFieldsSubmitting] = useState(false);
  const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);
  // Telegram uses a dedicated "/connect <code>" flow instead of a manual field.
  const [telegramConnect, setTelegramConnect] = useState<{
    state: string;
  } | null>(null);
  // Farcaster connects via the Sign In With Neynar widget.
  const [farcasterConnect, setFarcasterConnect] = useState<{
    clientId: string;
    state: string;
  } | null>(null);
  // Discord offers a choice at connect time: PostSider's shared bot (zero
  // setup, but every post shows the shared bot's own name/avatar — Discord's
  // Bot API has no per-message override for that) or the org's own bot
  // (pasted token + server ID, posts show up under their own bot's identity
  // instead). Reuses the existing customFields modal/submit flow below for
  // the "own bot" branch — no separate submit path needed.
  const [discordChoice, setDiscordChoice] = useState<{
    oauthUrl: string;
    customFields: CustomFieldDef[];
    state: string;
  } | null>(null);
  // Surfaced when a plan limit (e.g. channel cap) or other error blocks adding
  // a channel. Shown as a dismissible banner.
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelErrorIsPlanLimit, setChannelErrorIsPlanLimit] = useState(false);
  // Pending destructive action awaiting confirmation.
  const [confirm, setConfirm] = useState<
    | { kind: "channel"; id: string; name: string }
    | { kind: "post"; group: string }
    | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const today = new Date();

  const channelsById = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of channels) m.set(c.id, c);
    return m;
  }, [channels]);

  const visibleEvents = useMemo(
    () =>
      events.filter((e) => {
        if (!enabled.has(e.channelId)) return false;
        if (statusFilter !== "all" && e.status !== statusFilter) return false;
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          if (!(e.title + " " + (e.excerpt ?? "")).toLowerCase().includes(q)) {
            return false;
          }
        }
        return true;
      }),
    [enabled, events, statusFilter, search],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of visibleEvents) {
      const list = map.get(ev.date) ?? [];
      list.push(ev);
      map.set(ev.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.time.localeCompare(b.time));
    }
    return map;
  }, [visibleEvents]);

  // Channel rows in the panel are not toggles anymore; clicking opens the
  // channel detail modal. We keep this no-op so the panel API stays the same.
  const toggleChannel = (_id: string) => {};

  const updateChannelColor = (id: string, color: string) => {
    persistChannelColor(id, color);
    setChannels(
      channels.map((c) => (c.id === id ? { ...c, color } : c)),
    );
  };

  const deleteChannel = async (id: string) => {
    setOpenChannelId(null);
    // Optimistic update — remove locally; if the backend rejects, refresh.
    const prev = channels;
    setChannels(channels.filter((c) => c.id !== id));
    try {
      await deleteChannelApi(id);
      await refreshEvents();
    } catch (err) {
      console.error("[delete-channel]", err);
      setChannels(prev);
      setChannelError(t("errors.channelDelete"));
      setChannelErrorIsPlanLimit(false);
      void refreshChannels();
    }
  };

  const reconnectChannel = async (id: string) => {
    setOpenChannelId(null);
    const target = channels.find((c) => c.id === id);
    if (!target) return;
    // Map our friendly platform back to the provider identifier expected by
    // the OAuth endpoint. Best-effort lower-case match — works for the
    // popular providers; custom-instance ones (mastodon-custom, ...) need
    // an external URL and can't be re-connected from here yet.
    // Prefer the real backend provider identifier (e.g. "gmb",
    // "instagram-standalone", "linkedin-page"). Fall back to a slug derived
    // from the display label only for legacy/demo channels without it.
    const slug =
      target.identifier ||
      target.platform
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace("&", "and");
    try {
      const res = await getOauthUrl(slug, { refresh: id });
      // `res.url` is an opaque state token (used by widget-based flows like
      // Farcaster/Telegram), never a redirect target — only `oauthUrl` is a
      // real URL. Falling back to `res.url` here sent the browser to a
      // nonsensical relative path (the bare token string) and landed on a
      // 404. If oauthUrl is missing, OAuth just isn't configured for this
      // provider — surface that instead of silently doing nothing.
      if (res?.oauthUrl && typeof window !== "undefined") {
        window.location.href = res.oauthUrl;
      } else {
        setChannelError(t("errors.channelConnect"));
        setChannelErrorIsPlanLimit(false);
      }
    } catch (err) {
      console.error("[reconnect-channel]", err);
      const status = (err as { status?: number })?.status;
      if (status === 402) {
        setChannelError(t("limits.channels"));
        setChannelErrorIsPlanLimit(true);
      } else {
        setChannelError(t("errors.channelConnect"));
        setChannelErrorIsPlanLimit(false);
      }
    }
  };

  const addChannelForPlatform = async (platformId: string, platformLabel?: string) => {
    setChannelError(null);
    setChannelErrorIsPlanLimit(false);
    try {
      const res = await getOauthUrl(platformId);

      const hasOAuth = !!res?.oauthUrl;
      const hasCustomFields = !!(res?.customFields && res.customFields.length > 0);

      // Discord uniquely offers both — let the user pick instead of
      // silently always redirecting to the shared-bot OAuth flow.
      if (platformId === "discord" && hasOAuth && hasCustomFields) {
        setDiscordChoice({
          oauthUrl: res.oauthUrl!,
          customFields: res.customFields!,
          state: res.url || "",
        });
        return;
      }

      // OAuth provider — configured and ready: redirect immediately.
      if (hasOAuth) {
        window.location.href = res.oauthUrl!;
        return;
      }

      // Telegram — dedicated "/connect <code>" flow (auto-detects the chat via
      // the shared bot) instead of the manual chat-ID field.
      if (platformId === "telegram") {
        setTelegramConnect({ state: res.url || "" });
        return;
      }

      // Farcaster — Sign In With Neynar widget (auto-creates the signer) instead
      // of the manual signer-UUID field.
      if (platformId === "wrapcast" && res.neynarClientId) {
        setFarcasterConnect({ clientId: res.neynarClientId, state: res.url || "" });
        return;
      }

      // Manual-only provider (API key / token) — show credential form.
      if (hasCustomFields) {
        setCustomFieldsState({
          provider: platformId,
          label: platformLabel || platformId,
          fields: res.customFields!,
          state: res.url || "",
        });
        setCustomFieldsError(null);
        return;
      }

      // OAuth provider but NOT configured on server (no env vars set).
      // The backend returned no oauthUrl and no customFields.
      // Show a user-friendly message.
      setCustomFieldsError(
        `${platformLabel || platformId} is not available yet. Please contact support.`,
      );

    } catch (err) {
      console.error("[add-channel]", err);
      const status = (err as { status?: number })?.status;
      if (status === 402) {
        setChannelError(t("limits.channels"));
        setChannelErrorIsPlanLimit(true);
      } else {
        setChannelError(t("errors.channelConnect"));
        setChannelErrorIsPlanLimit(false);
      }
    }
  };

  const handleCustomFieldsSubmit = async (values: Record<string, string>) => {
    if (!customFieldsState) return;
    setCustomFieldsSubmitting(true);
    setCustomFieldsError(null);
    try {
      const code = btoa(JSON.stringify(values));
      const result = await connectIntegration(customFieldsState.provider, {
        code,
        state: customFieldsState.state,
      });
      if (result?.error) {
        setCustomFieldsError(result.error);
        setCustomFieldsSubmitting(false);
        return;
      }
      setCustomFieldsState(null);
      setCustomFieldsSubmitting(false);
      await refreshChannels();
    } catch (err) {
      setCustomFieldsError(
        err instanceof Error ? err.message : "Connection failed. Please check your credentials.",
      );
      setCustomFieldsSubmitting(false);
    }
  };

  const openChannel =
    openChannelId !== null ? channelsById.get(openChannelId) ?? null : null;

  const goPrev = () => {
    setCursor((c) => {
      const d = new Date(c);
      if (view === "day") d.setDate(d.getDate() - 1);
      else if (view === "week") d.setDate(d.getDate() - 7);
      else if (view === "month") d.setMonth(d.getMonth() - 1);
      else if (view === "year") d.setFullYear(d.getFullYear() - 1);
      return d;
    });
  };

  const goNext = () => {
    setCursor((c) => {
      const d = new Date(c);
      if (view === "day") d.setDate(d.getDate() + 1);
      else if (view === "week") d.setDate(d.getDate() + 7);
      else if (view === "month") d.setMonth(d.getMonth() + 1);
      else if (view === "year") d.setFullYear(d.getFullYear() + 1);
      return d;
    });
  };

  const goToday = () => {
    setCursor(new Date());
    setSelected(new Date());
  };

  // Switching to a day/week timeline should center on today (or the currently
  // selected day), NOT the 1st of the month — otherwise "Week"/"Day" jump back
  // to the start of the month. Month/Year keep the cursor (their period is
  // derived from it).
  const changeView = (m: ViewMode) => {
    if (m === "day" || m === "week") {
      const anchor = selected ?? new Date();
      setCursor(anchor);
      setSelected(anchor);
    }
    setView(m);
  };

  const monthNames = useMemo(() => buildMonthNames(locale), [locale]);

  const headerTitle = useMemo(() => {
    if (view === "day") {
      return cursor.toLocaleDateString(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    }
    if (view === "week") {
      const start = startOfWeek(cursor);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      const startStr = start.toLocaleDateString(locale, {
        day: "numeric",
        month: sameMonth ? undefined : "short",
      });
      const endStr = end.toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
      });
      return `${startStr} - ${endStr}`;
    }
    if (view === "month") {
      return monthNames[cursor.getMonth()];
    }
    return String(cursor.getFullYear());
  }, [view, cursor, locale, monthNames]);

  const headerSub = useMemo(() => {
    if (view === "year") return t("calendar.twelveMonths");
    return String(cursor.getFullYear());
  }, [view, cursor, t]);

  // Read-only display of the browser's timezone as a GMT offset — a light
  // context cue in the toolbar, not a setting.
  const timezoneLabel = useMemo(() => {
    const offset = -new Date().getTimezoneOffset() / 60;
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    const hh = String(Math.floor(abs)).padStart(2, "0");
    const mm = String(Math.round((abs - Math.floor(abs)) * 60)).padStart(2, "0");
    return `GMT${sign}${hh}:${mm}`;
  }, []);

  const summaryMetrics = useMemo(() => {
    let scheduled = 0;
    let awaiting = 0;
    let drafts = 0;
    for (const ev of events) {
      if (ev.status === "scheduled") scheduled += 1;
      else if (ev.status === "pendingApproval") awaiting += 1;
      else if (ev.status === "draft") drafts += 1;
    }
    return {
      scheduled,
      channels: channels.length,
      awaiting,
      drafts,
    };
  }, [events, channels]);

  /**
   * Send the composer payload to the backend. The composer doesn't know about
   * media-row IDs vs paths, so we pass through whatever was attached. Today
   * the composer only carries object URLs (local-only). When media uploads
   * land we'll start sending the saved Media id/path here.
   */
  const submitPost = async (
    post: NewPostInput,
    type: "draft" | "schedule" | "now" | "update",
    group?: string,
  ) => {
    await submitPostReturning(post, type, group);
  };

  /** Like submitPost but returns the created posts (id + integration) so the
   * caller can chain follow-up actions (e.g. submit each to approval). */
  const submitPostReturning = async (
    post: NewPostInput,
    type: "draft" | "schedule" | "now" | "update",
    group?: string,
  ): Promise<Array<{ postId: string; integration: string }>> => {
    const isoDate = (() => {
      if (post.date && post.time) {
        const dt = new Date(`${post.date}T${post.time}:00`);
        return dt.toISOString();
      }
      // Drafts may have no date — fall back to "now" so the backend has
      // something to store; it'll surface in the drafts tab regardless.
      return new Date().toISOString();
    })();

    // Upload any attached media (the composer holds them as local object URLs)
    // so the backend gets publicly reachable paths — required by providers
    // like Instagram. Media that already exists server-side (edit mode,
    // backendId set) rides along as {id, path} instead of being re-uploaded.
    const uploadedMedia: { id?: string; path: string }[] = [];
    for (const m of post.media) {
      if (m.backendId) {
        uploadedMedia.push({ id: m.backendId, path: m.url });
        continue;
      }
      try {
        const blob = await fetch(m.url).then((r) => r.blob());
        const result = await uploadMedia(blob, m.name);
        uploadedMedia.push(result);
      } catch (err) {
        console.error("[upload-media]", err);
        throw new Error(
          `We couldn't upload "${m.name}". Please check the file and try again.`,
        );
      }
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
    try {
      return await createPost(input);
    } catch (err) {
      console.error("[create-post]", err);
      throw err;
    }
  };

  /**
   * Open an existing calendar post for preview/edit. Fetches full detail
   * (body + thread parts + provider settings) and opens the modal prefilled.
   */
  const openEventForEdit = async (ev: CalendarEvent) => {
    if (editLoading) return;
    setOpenDay(null);
    setEditError(null);
    setEditRetryEvent(null);
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
        // Existing media must be prefilled — the composer starts empty and a
        // save would otherwise wipe the attachments (image:[]).
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
      // Fetch approval status for the post so the composer can show a
      // rejection banner and offer a re-submit button.
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
      setEditPost({
        group: detail.group,
        initial,
        approvalStatus,
        rejectionNote,
      });
    } catch (err) {
      console.error("[edit-post]", err);
      setEditError(t("errors.postEdit"));
      setEditRetryEvent(ev);
    } finally {
      setEditLoading(false);
    }
  };

  const deletePost = async (group: string) => {
    try {
      await deletePostGroup(group);
      await refreshEvents();
    } catch (err) {
      console.error("[delete-post]", err);
      setChannelError(t("errors.postDelete"));
      setChannelErrorIsPlanLimit(false);
    }
  };

  /**
   * Reschedule a single post to a new date (and optionally a new time) via
   * drag-and-drop. Only scheduled posts can be moved — drafts have no date and
   * published/failed posts are immutable. The update is optimistic: we patch
   * the local event immediately, then reconcile with the backend.
   */
  const moveEvent = async (eventId: string, target: Date, newTime?: string) => {
    if (isMember) return;
    const ev = events.find((e) => e.id === eventId);
    if (!ev || !isDraggableStatus(ev.status)) return;

    const time = newTime || ev.time || "09:00";
    const newDate = iso(target);
    if (newDate === ev.date && time === ev.time) return;

    const [hh, mm] = time.split(":").map(Number);
    const dt = new Date(
      target.getFullYear(),
      target.getMonth(),
      target.getDate(),
      hh || 0,
      mm || 0,
      0,
      0,
    );

    // Optimistic update so the post jumps to its new slot instantly.
    const prev = events;
    setEvents(
      events.map((e) =>
        e.id === eventId ? { ...e, date: newDate, time } : e,
      ),
    );
    try {
      await changePostDate(eventId, dt.toISOString(), "schedule");
      void refreshEvents();
    } catch (err) {
      console.error("[reschedule]", err);
      setEvents(prev);
      setChannelError(t("errors.postReschedule"));
      setChannelErrorIsPlanLimit(false);
    }
  };

  // Run whatever destructive action is currently pending confirmation.
  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === "channel") {
        await deleteChannel(confirm.id);
      } else {
        await deletePost(confirm.group);
      }
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className={styles.shell}>

      <ChannelsPanel
        channels={channels}
        enabled={enabled}
        collapsed={panelCollapsed}
        hideActions={isMember}
        onToggleChannel={toggleChannel}
        onToggleCollapse={() => setPanelCollapsed((v) => !v)}
        onOpenChannel={isMember ? undefined : (id) => setOpenChannelId(id)}
        onAddChannel={isMember ? undefined : () => setAddChannelOpen(true)}
        onCreatePost={
          isMember
            ? undefined
            : () => {
                const now = new Date();
                const pad = (n: number) => String(n).padStart(2, "0");
                setComposer({
                  date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
                  time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
                });
              }
        }
      />

      <div className={styles.root}>
        {channelError && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderRadius: "var(--radius-md)",
              background: "rgba(220, 38, 38, 0.08)",
              color: "#c0392b",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <span style={{ flex: 1 }}>{channelError}</span>
            {channelErrorIsPlanLimit && (
              <a
                href="/billing"
                style={{
                  fontWeight: 600,
                  color: "#c0392b",
                  textDecoration: "underline",
                  whiteSpace: "nowrap",
                }}
              >
                {t("common.viewPlans")}
              </a>
            )}
            <button
              type="button"
              onClick={() => setChannelError(null)}
              aria-label={t("common.dismiss")}
              style={{
                border: "none",
                background: "transparent",
                color: "#c0392b",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        )}
        {loadError && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderRadius: "var(--radius-md)",
              background: "rgba(220, 38, 38, 0.08)",
              color: "#c0392b",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <span style={{ flex: 1 }}>{t("calendar.loadError")}</span>
            <button
              type="button"
              onClick={() => {
                if (channelsError) void refreshChannels();
                if (eventsError) void refreshEvents();
              }}
              style={{
                border: "none",
                background: "transparent",
                fontWeight: 600,
                color: "#c0392b",
                textDecoration: "underline",
                whiteSpace: "nowrap",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
              }}
            >
              {t("calendar.retry")}
            </button>
          </div>
        )}
        {editError && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderRadius: "var(--radius-md)",
              background: "rgba(220, 38, 38, 0.08)",
              color: "#c0392b",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <span style={{ flex: 1 }}>{editError}</span>
            {editRetryEvent && (
              <button
                type="button"
                onClick={() => void openEventForEdit(editRetryEvent)}
                disabled={editLoading}
                style={{
                  border: "none",
                  background: "transparent",
                  fontWeight: 600,
                  color: "#c0392b",
                  textDecoration: "underline",
                  whiteSpace: "nowrap",
                  cursor: editLoading ? "default" : "pointer",
                  fontSize: 13,
                  padding: 0,
                }}
              >
                {t("calendar.retry")}
              </button>
            )}
          </div>
        )}
        {!isMember && (
          <SetupChecklist
            channels={channels}
            raw={rawChannels}
            loading={channelsLoading}
            refreshSignal={postCreatedTick}
            onConnect={() => setAddChannelOpen(true)}
            onCompose={() => {
              const now = new Date();
              const pad = (n: number) => String(n).padStart(2, "0");
              setComposer({
                date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
                time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
              });
            }}
          />
        )}

        <div className={styles.header}>
          <div className={styles.title}>
            <span className={styles.titleMain}>{headerTitle}</span>
            <span className={styles.titleSub}>{headerSub}</span>
          </div>

          <div className={styles.headerRight}>
            <div className={styles.searchWrap}>
              <svg viewBox="0 0 16 16" fill="none" aria-hidden className={styles.searchIcon}>
                <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
                <path d="m10.25 10.25 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                className={styles.searchInput}
                placeholder={t("calendar.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t("calendar.searchPlaceholder")}
              />
              <kbd className={styles.searchKbd}>⌘K</kbd>
            </div>

            <div className={styles.filterWrap} ref={filterRef}>
              <button
                type="button"
                className={styles.filterBtn + (statusFilter !== "all" ? " " + styles.filterBtnActive : "")}
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
              >
                {t("calendar.filters")}
                <svg viewBox="0 0 16 16" fill="none" aria-hidden className={styles.filterIcon}>
                  <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {filtersOpen && (
                <div className={styles.filterMenu} role="listbox">
                  {(
                    [
                      ["all", "posts.all"],
                      ["scheduled", "posts.status.scheduled"],
                      ["draft", "posts.status.draft"],
                      ["pendingApproval", "posts.status.pendingApproval"],
                      ["failed", "posts.status.error"],
                      ["held", "posts.status.held"],
                    ] as const
                  ).map(([value, labelKey]) => (
                    <button
                      key={value}
                      type="button"
                      role="option"
                      aria-selected={statusFilter === value}
                      className={styles.filterOption + (statusFilter === value ? " " + styles.filterOptionActive : "")}
                      onClick={() => {
                        setStatusFilter(value);
                        setFiltersOpen(false);
                      }}
                    >
                      {t(labelKey as any)}
                      {statusFilter === value && <span aria-hidden>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span className={styles.tzLabel}>{timezoneLabel}</span>

            <div className={styles.segmented} role="tablist" aria-label="View">
              {(Object.keys(VIEW_LABELS) as ViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={view === m}
                  className={
                    styles.segment +
                    (view === m ? " " + styles.segmentActive : "")
                  }
                  onClick={() => changeView(m)}
                >
                  {t(VIEW_LABELS[m] as any)}
                </button>
              ))}
            </div>

            <div className={styles.controls}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={goPrev}
                aria-label={t("calendar.previous")}
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                className={styles.todayBtn}
                onClick={goToday}
              >
                {t("calendar.today")}
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={goNext}
                aria-label={t("calendar.next")}
              >
                <ChevronRight />
              </button>
            </div>
          </div>
        </div>

        {initialLoading && !loadError ? (
          <div className={styles.loadingState} role="status">
            <span className={styles.loadingDot} aria-hidden />
            {t("calendar.loading")}
          </div>
        ) : channels.length === 0 ? (
          <EmptyState
            icon="channel"
            title={t("calendar.emptyTitle")}
            description={
              isMember
                ? t("calendar.emptyDescMember")
                : t("calendar.emptyDescAdmin")
            }
            {...(!isMember
              ? {
                  actionLabel: t("calendar.addChannel"),
                  onAction: () => setAddChannelOpen(true),
                }
              : {})}
          />
        ) : (
          <>
        {view === "month" && (
          <MonthView
            cursor={cursor}
            today={today}
            selected={selected}
            onSelect={(d) => {
              setSelected(d);
              setOpenDay(d);
            }}
            eventsByDay={eventsByDay}
            channelsById={channelsById}
            onMoveEvent={isMember ? undefined : moveEvent}
          />
        )}

        {view === "week" && (
          <WeekView
            cursor={cursor}
            today={today}
            eventsByDay={eventsByDay}
            channelsById={channelsById}
            onCreate={(d, time) =>
              setComposer({ date: iso(d), time })
            }
            onMoveEvent={isMember ? undefined : moveEvent}
            onOpenEvent={isMember ? undefined : (ev) => void openEventForEdit(ev)}
          />
        )}

        {view === "day" && (
          <DayView
            cursor={cursor}
            today={today}
            eventsByDay={eventsByDay}
            channelsById={channelsById}
            onCreate={(d, time) =>
              setComposer({ date: iso(d), time })
            }
            onMoveEvent={isMember ? undefined : moveEvent}
            onOpenEvent={isMember ? undefined : (ev) => void openEventForEdit(ev)}
          />
        )}

        {view === "year" && (
          <YearView
            cursor={cursor}
            today={today}
            eventsByDay={eventsByDay}
            onPickMonth={(m) => {
              setCursor(new Date(cursor.getFullYear(), m, 1));
              setView("month");
            }}
          />
        )}
          </>
        )}

        {channels.length > 0 && (
          <SummaryBar metrics={summaryMetrics} />
        )}
      </div>

      {openChannel && (
        <ChannelDetailModal
          channel={openChannel}
          onClose={() => setOpenChannelId(null)}
          onColorChange={(color) => updateChannelColor(openChannel.id, color)}
          onReconnect={() => reconnectChannel(openChannel.id)}
          onDelete={() =>
            setConfirm({
              kind: "channel",
              id: openChannel.id,
              name: openChannel.name,
            })
          }
        />
      )}

      {addChannelOpen && (
        <AddChannelModal
          onClose={() => setAddChannelOpen(false)}
          onPick={(id, label) => {
            setAddChannelOpen(false);
            void addChannelForPlatform(id, label);
          }}
        />
      )}

      {customFieldsState && (
        <CustomFieldsModal
          provider={customFieldsState.provider}
          label={customFieldsState.label}
          fields={customFieldsState.fields}
          onClose={() => {
            setCustomFieldsState(null);
            setCustomFieldsError(null);
          }}
          onSubmit={handleCustomFieldsSubmit}
          submitting={customFieldsSubmitting}
          error={customFieldsError}
        />
      )}

      {telegramConnect && (
        <TelegramConnectModal
          state={telegramConnect.state}
          onClose={() => setTelegramConnect(null)}
          onConnected={() => {
            setTelegramConnect(null);
            void refreshChannels();
          }}
        />
      )}

      {farcasterConnect && (
        <FarcasterConnectModal
          clientId={farcasterConnect.clientId}
          state={farcasterConnect.state}
          onClose={() => setFarcasterConnect(null)}
          onConnected={() => {
            setFarcasterConnect(null);
            void refreshChannels();
          }}
        />
      )}

      {discordChoice && (
        <DiscordBotChoiceModal
          onCancel={() => setDiscordChoice(null)}
          onChooseShared={() => {
            const url = discordChoice.oauthUrl;
            setDiscordChoice(null);
            window.location.href = url;
          }}
          onChooseOwn={() => {
            setCustomFieldsState({
              provider: "discord",
              label: "Discord",
              fields: discordChoice.customFields,
              state: discordChoice.state,
            });
            setDiscordChoice(null);
          }}
        />
      )}

      {openDay && (
        <DayPopup
          date={openDay}
          events={eventsByDay.get(iso(openDay)) ?? []}
          channelsById={channelsById}
          onClose={() => setOpenDay(null)}
          onCreate={(d, time) => {
            setComposer({ date: iso(d), time });
          }}
          onEditEvent={isMember ? undefined : (ev) => void openEventForEdit(ev)}
        />
      )}

      {composer && (
        <CreatePostModal
          channels={channels}
          date={composer.date}
          time={composer.time}
          onClose={() => setComposer(null)}
          onSaveDraft={async (post) => {
            await submitPost(post, "draft");
            setComposer(null);
            void refreshEvents();
            setPostCreatedTick((n) => n + 1);
          }}
          onSendToApproval={async (post) => {
            // Create as a DRAFT, then submit each created post for approval.
            // Approval itself needs the post to already be a draft.
            const created = await submitPostReturning(post, "draft");
            for (const c of created ?? []) {
              await requestApproval(c.postId);
            }
            setComposer(null);
            void refreshEvents();
            setPostCreatedTick((n) => n + 1);
          }}
          onSchedule={async (post) => {
            await submitPost(post, "schedule");
            setComposer(null);
            void refreshEvents();
            setPostCreatedTick((n) => n + 1);
          }}
          onPublishNow={async (post) => {
            await submitPost(post, "now");
            setComposer(null);
            void refreshEvents();
            setPostCreatedTick((n) => n + 1);
          }}
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
            await submitPost(post, "update", editPost.group);
            setEditPost(null);
            void refreshEvents();
          }}
          onPublishNow={async (post) => {
            await submitPost(post, "now", editPost.group);
            setEditPost(null);
            void refreshEvents();
          }}
          onSendToApproval={
            editPost.approvalStatus === "rejected"
              ? async (post) => {
                  await submitPost(post, "update", editPost.group);
                  // Re-submit: the post is already a draft, just re-request approval
                  for (const c of (await submitPostReturning(post, "draft", editPost.group)) ?? []) {
                    await requestApproval(c.postId);
                  }
                  setEditPost(null);
                  void refreshEvents();
                }
              : undefined
          }
          onDelete={async () => {
            const group = editPost.group;
            setEditPost(null);
            setConfirm({ kind: "post", group });
          }}
          approvalStatus={editPost.approvalStatus}
          rejectionNote={editPost.rejectionNote}
        />
      )}

      {confirm && (
        <ConfirmDialog
          danger
          busy={confirmBusy}
          title={
            confirm.kind === "channel"
              ? t("channels.deleteConfirmTitle")
              : t("posts.deleteConfirmTitle")
          }
          body={
            confirm.kind === "channel"
              ? t("channels.deleteConfirmBody", { name: confirm.name })
              : t("posts.deleteConfirmBody")
          }
          confirmLabel={
            confirm.kind === "channel"
              ? t("channels.disconnect")
              : t("posts.deleteBtn")
          }
          onConfirm={() => void runConfirm()}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/* ───────── MONTH ───────── */

interface MonthViewProps {
  cursor: Date;
  today: Date;
  selected: Date | null;
  onSelect: (d: Date) => void;
  eventsByDay: Map<string, CalendarEvent[]>;
  channelsById: Map<string, Channel>;
  onMoveEvent?: (eventId: string, target: Date, newTime?: string) => void;
}

function MonthView({
  cursor,
  today,
  selected,
  onSelect,
  eventsByDay,
  channelsById,
  onMoveEvent,
}: MonthViewProps) {
  const t = useT();
  const { locale } = useI18n();
  const weekdays = useMemo(() => buildWeekdayNames(locale, "short"), [locale]);
  const cells = useMemo(
    () => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  return (
    <>
      <div className={styles.monthWrap}>
        <div className={styles.weekdays}>
          {weekdays.map((d, idx) => (
            <div
              key={idx}
              className={
                styles.weekday + (idx >= 5 ? " " + styles.weekendLabel : "")
              }
            >
              {d}
            </div>
          ))}
        </div>

        <div className={styles.grid} role="grid">
          {cells.map((cell, idx) => {
            const isToday = isSameDay(cell.date, today);
            const isSelected = selected ? isSameDay(cell.date, selected) : false;
            const isWeekend = idx % 7 >= 5;
            const dayEvents = eventsByDay.get(iso(cell.date)) ?? [];

            const cellClassNames = [
              styles.cell,
              !cell.inCurrentMonth && styles.cellOutOfMonth,
              isSelected && styles.cellSelected,
            ]
              .filter(Boolean)
              .join(" ");

            const isDropTarget = onMoveEvent && cell.inCurrentMonth;

            return (
              <button
                type="button"
                key={idx}
                role="gridcell"
                aria-selected={isSelected}
                aria-current={isToday ? "date" : undefined}
                className={cellClassNames}
                onClick={() => onSelect(cell.date)}
                style={
                  dragOverIdx === idx
                    ? { outline: "2px solid var(--fg)", outlineOffset: -2 }
                    : undefined
                }
                onDragOver={
                  isDropTarget
                    ? (e) => {
                        e.preventDefault();
                        if (dragOverIdx !== idx) setDragOverIdx(idx);
                      }
                    : undefined
                }
                onDragLeave={
                  isDropTarget
                    ? () => setDragOverIdx((cur) => (cur === idx ? null : cur))
                    : undefined
                }
                onDrop={
                  isDropTarget
                    ? (e) => {
                        e.preventDefault();
                        setDragOverIdx(null);
                        const id = e.dataTransfer.getData("text/plain");
                        if (id) onMoveEvent!(id, cell.date);
                      }
                    : undefined
                }
              >
                <div className={styles.dayHead}>
                  <span
                    className={
                      styles.dayNumber +
                      (isToday ? " " + styles.dayNumberToday : "") +
                      (isWeekend && !isToday ? " " + styles.dayWeekend : "")
                    }
                  >
                    {cell.date.getDate()}
                  </span>
                  {dayEvents.length > 0 && cell.inCurrentMonth && (
                    <span className={styles.eventCount}>
                      {dayEvents.length}
                    </span>
                  )}
                </div>

                {cell.inCurrentMonth && dayEvents.length > 0 && (
                  <div className={styles.events}>
                    {dayEvents.slice(0, 2).map((ev) => {
                      const c = channelsById.get(ev.channelId);
                      const canDrag = !!onMoveEvent && isDraggableStatus(ev.status);
                      return (
                        <span
                          key={ev.id}
                          className={styles.event}
                          draggable={canDrag}
                          onDragStart={
                            canDrag
                              ? (e) => {
                                  e.stopPropagation();
                                  e.dataTransfer.setData("text/plain", ev.id);
                                  e.dataTransfer.effectAllowed = "move";
                                }
                              : undefined
                          }
                          style={
                            c
                              ? {
                                  borderLeft: `3px solid ${c.color}`,
                                  ...(canDrag ? { cursor: "grab" } : {}),
                                }
                              : canDrag
                                ? { cursor: "grab" }
                                : undefined
                          }
                          title={`${ev.time} · ${ev.title}${
                            c ? ` · ${c.name} (${c.platform})` : ""
                          }`}
                        >
                          {c ? (
                            <PlatformIcon
                              platform={c.platform}
                              size={16}
                            />
                          ) : (
                            <span
                              className={styles.eventDot}
                              aria-hidden
                            >?</span>
                          )}
                          <span className={styles.eventLabel}>{ev.title}</span>
                        </span>
                      );
                    })}
                    {dayEvents.length > 2 && (
                      <span className={styles.eventMore}>
                        {t("calendar.moreCount", {
                          count: dayEvents.length - 2,
                        })}
                      </span>
                    )}
                  </div>
                )}

                {cell.inCurrentMonth && dayEvents.length === 0 && (
                  <span className={styles.cellAdd} aria-hidden>
                    +
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function SummaryBar({
  metrics,
}: {
  metrics: {
    scheduled: number;
    channels: number;
    awaiting: number;
    drafts: number;
  };
}) {
  const t = useT();
  const items = [
    { label: t("calendar.summaryScheduled"), value: metrics.scheduled, accent: false },
    { label: t("calendar.summaryChannels"), value: metrics.channels, accent: false },
    { label: t("calendar.summaryAwaiting"), value: metrics.awaiting, accent: true },
    { label: t("calendar.summaryDrafts"), value: metrics.drafts, accent: false },
  ];
  return (
    <div className={styles.summaryBar}>
      {items.map((it, i) => (
        <div
          key={it.label}
          className={styles.summaryItem + (i > 0 ? " " + styles.summaryItemBorder : "")}
        >
          <span className={styles.summaryIcon} aria-hidden>
            {it.label === t("calendar.summaryScheduled") ? (
              <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                <rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
                <path d="M2.5 6h11M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            ) : it.label === t("calendar.summaryChannels") ? (
              <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                <circle cx="5.5" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="10.5" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.4" />
                <path d="M2.5 12c.8-1.6 2-2.5 3-2.5s2.2.9 3 2.5M7.5 12c.8-1.6 2-2.5 3-2.5s2.2.9 3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            ) : it.label === t("calendar.summaryAwaiting") ? (
              <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                <path d="M3.5 9.5l2.5 2.5 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span className={styles.summaryValue + (it.accent ? " " + styles.summaryValueAccent : "")}>
            {it.value}
          </span>
          <span className={styles.summaryLabel}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────── TIMELINE (week + day) ───────── */

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function eventTopAndHeight(time: string, durationMinutes: number) {
  const [h, m] = time.split(":").map(Number);
  const minutes = h * 60 + m;
  const top = (minutes / 60) * HOUR_HEIGHT;
  const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT, 26);
  return { top, height };
}

/** "HH:mm" → minutes from midnight (for overlap layout). */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatHourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

interface TimelineProps {
  days: Date[];
  today: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  channelsById: Map<string, Channel>;
  showWeekdayLabels: boolean;
  onCreate?: (date: Date, time: string) => void;
  onMoveEvent?: (eventId: string, target: Date, newTime?: string) => void;
  onOpenEvent?: (ev: CalendarEvent) => void;
}

function Timeline({
  days,
  today,
  eventsByDay,
  channelsById,
  showWeekdayLabels,
  onCreate,
  onMoveEvent,
  onOpenEvent,
}: TimelineProps) {
  const t = useT();
  const { locale } = useI18n();
  const weekdays = useMemo(() => buildWeekdayNames(locale, "short"), [locale]);
  const cols = days.length;
  const gridTemplate = `64px repeat(${cols}, 1fr)`;
  const [dragOver, setDragOver] = useState<string | null>(null);

  const todayColIdx = days.findIndex((d) => isSameDay(d, today));
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;

  return (
    <div className={styles.timeline}>
      <div
        className={styles.timelineHeader}
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className={styles.timelineHeaderSpacer} />
        {days.map((d) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={d.toISOString()} className={styles.timelineHeaderCell}>
              {showWeekdayLabels && (
                <span className={styles.timelineHeaderDay}>
                  {weekdays[(d.getDay() + 6) % 7]}
                </span>
              )}
              <span
                className={
                  styles.timelineHeaderDate +
                  (isToday ? " " + styles.timelineHeaderDateToday : "")
                }
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      <div
        className={styles.timelineBody}
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div>
          {HOURS.map((h) => (
            <div key={h} className={styles.timelineHourLabel}>
              {h === 0 ? "" : formatHourLabel(h)}
            </div>
          ))}
        </div>

        {days.map((d, colIdx) => {
          const dayEvents = eventsByDay.get(iso(d)) ?? [];
          return (
            <div key={d.toISOString()} className={styles.timelineColumn}>
              {HOURS.map((h) => {
                const slotKey = `${iso(d)}-${h}`;
                return (
                  <button
                    type="button"
                    key={h}
                    className={styles.timelineHourSlot}
                    onClick={() =>
                      onCreate?.(
                        d,
                        `${String(h).padStart(2, "0")}:00`,
                      )
                    }
                    aria-label={t("calendar.addPostAt", {
                      time: formatHourLabel(h),
                    })}
                    style={
                      dragOver === slotKey
                        ? { outline: "2px solid var(--fg)", outlineOffset: -2 }
                        : undefined
                    }
                    onDragOver={
                      onMoveEvent
                        ? (e) => {
                            e.preventDefault();
                            if (dragOver !== slotKey) setDragOver(slotKey);
                          }
                        : undefined
                    }
                    onDragLeave={
                      onMoveEvent
                        ? () =>
                            setDragOver((cur) =>
                              cur === slotKey ? null : cur,
                            )
                        : undefined
                    }
                    onDrop={
                      onMoveEvent
                        ? (e) => {
                            e.preventDefault();
                            setDragOver(null);
                            const id = e.dataTransfer.getData("text/plain");
                            if (id)
                              onMoveEvent(
                                id,
                                d,
                                `${String(h).padStart(2, "0")}:00`,
                              );
                          }
                        : undefined
                    }
                  >
                    <span className={styles.timelineHourPlus} aria-hidden>
                      +
                    </span>
                  </button>
                );
              })}

              {colIdx === todayColIdx && (
                <div className={styles.nowLine} style={{ top: nowTop }} />
              )}

              {(() => {
                // Overlapping events (same or near same time) are laid out
                // side by side instead of stacking on top of each other.
                const placements = layoutOverlappingEvents(
                  dayEvents.map((ev) => ({
                    id: ev.id,
                    startMin: timeToMinutes(ev.time),
                    endMin:
                      timeToMinutes(ev.time) +
                      (ev.durationMinutes ?? DEFAULT_DURATION),
                  })),
                );
                return dayEvents.map((ev) => {
                  const { top, height } = eventTopAndHeight(
                    ev.time,
                    ev.durationMinutes ?? DEFAULT_DURATION,
                  );
                  const c = channelsById.get(ev.channelId);
                  const canDrag = !!onMoveEvent && isDraggableStatus(ev.status);
                  const placement = placements.get(ev.id);
                  return (
                    <div
                      key={ev.id}
                      className={styles.timelineEvent}
                      draggable={canDrag}
                      onClick={() => onOpenEvent?.(ev)}
                      onDragStart={
                        canDrag
                          ? (e) => {
                              e.stopPropagation();
                              e.dataTransfer.setData("text/plain", ev.id);
                              e.dataTransfer.effectAllowed = "move";
                            }
                          : undefined
                      }
                      style={{
                        top,
                        height,
                        borderLeft: c ? `3px solid ${c.color}` : undefined,
                        ...(canDrag ? { cursor: "grab" } : {}),
                        ...(placement
                          ? {
                              left: `calc(${placement.leftPct}% + 6px)`,
                              width: `calc(${placement.widthPct}% - 12px)`,
                            }
                          : {}),
                      }}
                    >
                      <div className={styles.timelineEventHead}>
                        {c ? (
                          <PlatformIcon platform={c.platform} size={16} />
                        ) : (
                          <span
                            className={styles.timelineEventBadge}
                            aria-hidden
                          >?</span>
                        )}
                        <span className={styles.timelineEventTitle}>
                          {ev.title}
                        </span>
                      </div>
                      <span className={styles.timelineEventMeta}>
                        {ev.time}
                        {c ? ` · ${c.name}` : ""}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── WEEK ───────── */

interface WeekViewProps {
  cursor: Date;
  today: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  channelsById: Map<string, Channel>;
  onCreate?: (date: Date, time: string) => void;
  onMoveEvent?: (eventId: string, target: Date, newTime?: string) => void;
  onOpenEvent?: (ev: CalendarEvent) => void;
}

function WeekView({
  cursor,
  today,
  eventsByDay,
  channelsById,
  onCreate,
  onMoveEvent,
  onOpenEvent,
}: WeekViewProps) {
  const weekStart = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <Timeline
      days={days}
      today={today}
      eventsByDay={eventsByDay}
      channelsById={channelsById}
      showWeekdayLabels
      onCreate={onCreate}
      onMoveEvent={onMoveEvent}
      onOpenEvent={onOpenEvent}
    />
  );
}

/* ───────── DAY ───────── */

interface DayViewProps {
  cursor: Date;
  today: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  channelsById: Map<string, Channel>;
  onCreate?: (date: Date, time: string) => void;
  onMoveEvent?: (eventId: string, target: Date, newTime?: string) => void;
  onOpenEvent?: (ev: CalendarEvent) => void;
}

function DayView({
  cursor,
  today,
  eventsByDay,
  channelsById,
  onCreate,
  onMoveEvent,
  onOpenEvent,
}: DayViewProps) {
  return (
    <Timeline
      days={[cursor]}
      today={today}
      eventsByDay={eventsByDay}
      channelsById={channelsById}
      showWeekdayLabels
      onCreate={onCreate}
      onMoveEvent={onMoveEvent}
      onOpenEvent={onOpenEvent}
    />
  );
}

/* ───────── YEAR ───────── */

interface YearViewProps {
  cursor: Date;
  today: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  onPickMonth: (month: number) => void;
}

function YearView({ cursor, today, eventsByDay, onPickMonth }: YearViewProps) {
  const { locale } = useI18n();
  const monthNames = useMemo(() => buildMonthNames(locale), [locale]);
  const weekdaysNarrow = useMemo(
    () => buildWeekdayNames(locale, "narrow"),
    [locale],
  );
  const year = cursor.getFullYear();

  return (
    <div className={styles.yearGrid}>
      {monthNames.map((name, m) => {
        const cells = buildMonthGrid(year, m);
        return (
          <button
            type="button"
            key={name}
            className={styles.yearMonth}
            onClick={() => onPickMonth(m)}
          >
            <span className={styles.yearMonthName}>{name}</span>
            <div className={styles.yearMonthGrid}>
              {weekdaysNarrow.map((d, i) => (
                <span key={"w" + i} className={styles.yearWeekday}>
                  {d}
                </span>
              ))}
              {cells.map((cell, idx) => {
                const isToday = isSameDay(cell.date, today);
                const muted = !cell.inCurrentMonth;
                const hasEvent =
                  cell.inCurrentMonth &&
                  (eventsByDay.get(iso(cell.date))?.length ?? 0) > 0;
                return (
                  <span
                    key={idx}
                    className={
                      styles.yearDay +
                      (muted ? " " + styles.yearDayMuted : "") +
                      (isToday ? " " + styles.yearDayToday : "") +
                      (hasEvent && !isToday ? " " + styles.yearDayHasEvent : "")
                    }
                  >
                    {cell.date.getDate()}
                  </span>
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
