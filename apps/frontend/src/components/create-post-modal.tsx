"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import styles from "./create-post-modal.module.css";
import { ChannelAvatar } from "./channel-avatar";
import { PostPreviewPanel } from "./post-preview/post-preview-panel";
import { PostCheckerPanel } from "./post-checker-panel";
import { SnippetsPanel } from "./snippets-panel";
import { RewritePanel } from "./rewrite-panel";
import { type UtmPreset } from "@/lib/composer-helpers-api";
import { appendUtmParams } from "@/lib/utm-utils";
import { findNextSlot } from "@/lib/queue-plan-api";
import { DatePicker, TimePicker } from "./date-picker";
import { type Channel } from "@/lib/calendar-data";
import {
  getIntegrationChannels,
  getTiktokCreatorInfo,
  type IntegrationChannel,
  type TiktokCreatorInfo,
} from "@/lib/integrations";
import {
  getProviderRequirement,
  identifierFromPlatform,
  defaultSettingsFor,
  effectiveMaxLength,
  type ProviderRequirement,
  type SettingsField,
  type MediaLike,
} from "@/lib/provider-requirements";
import { useT } from "@/lib/i18n";
import { InfoTip } from "./info-tip";
import { suggestSlots, type SlotSuggestion } from "@/lib/smart-slots-api";
import { getCommentProviders } from "@/lib/comment-providers";

interface CreatePostModalProps {
  channels: Channel[];
  /** Local YYYY-MM-DD. */
  date: string;
  /** HH:mm. */
  time: string;
  onClose: () => void;
  onSaveDraft: (post: NewPostInput) => void;
  onSchedule: (post: NewPostInput) => void;
  /** Publish immediately. When provided, a "Publish now" button is shown. */
  onPublishNow?: (post: NewPostInput) => void;
  /**
   * Save as a DRAFT and submit it for approval (admin/approver then approves
   * or rejects before it reaches the queue). Only shown when provided.
   */
  onSendToApproval?: (post: NewPostInput) => void;
  /** Delete the post. When provided (edit mode), a "Delete" button is shown. */
  onDelete?: () => void;
  /**
   * When set, the modal opens in edit mode: prefilled with these values and
   * the primary action updates the existing post instead of creating one.
   */
  initialValue?: InitialPostValue;
  /**
   * Approval status of the post being edited. When "rejected", the modal shows
   * a banner and the "Send to Approval" button for re-submission.
   */
  approvalStatus?: "pending" | "approved" | "rejected" | "none";
  /** The rejection note to display when the post was previously rejected. */
  rejectionNote?: string;
}

/** Prefill data for opening the modal in edit mode. */
export interface InitialPostValue {
  channelIds: string[];
  date: string;
  time: string;
  /** Main post body (first content item). */
  body: string;
  /** Thread parts (subsequent content items). */
  threadParts: string[];
  /** Per-channel provider settings (e.g. Discord channel). */
  perChannelSettings?: Record<string, Record<string, unknown>>;
  /** Media already attached to the post being edited. */
  media?: AttachedMedia[];
}

export interface NewPostInput {
  channelIds: string[];
  date: string;
  time: string;
  title: string;
  /** Default body shared across channels in global mode. */
  body: string;
  /** Per-channel overrides: channelId → body. Empty entries fall back to `body`. */
  perChannelBody: Record<string, string>;
  /** Threaded comments / chained posts. */
  threadParts: string[];
  /** Optional first comment, posted right after the main post. */
  firstComment?: string;
  /** Attached media (object URLs in this demo). */
  media: AttachedMedia[];
  /**
   * Per-channel provider settings keyed by integration id. e.g. Discord
   * requires `{ channel: "<channelId>" }`.
   */
  perChannelSettings?: Record<string, Record<string, unknown>>;
}

export interface AttachedMedia {
  id: string;
  name: string;
  kind: "image" | "video";
  size: number;
  /** Local object URL — fine for the demo, would be a server URL in production. */
  url: string;
  /**
   * Backend media id (when present, this media already exists server-side and
   * submitPost must NOT re-upload it — it rides along as {id, path}).
   */
  backendId?: string;
}

const GLOBAL_KEY = "__global__";

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="13" height="13">
      <path d="M3 5h10M6.5 3.5h3M5 5l.5 8a1.2 1.2 0 0 0 1.2 1.1h2.6A1.2 1.2 0 0 0 10.5 13l.5-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="6.5" r="1" fill="currentColor" />
      <path d="M3 11.5 6.5 8.5l3 3 1.7-1.5 1.8 1.7" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <rect x="2.5" y="4" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 6.7 10 8 7 9.3V6.7Z" fill="currentColor" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <path d="M3 4.25C3 3.56 3.56 3 4.25 3h7.5C12.44 3 13 3.56 13 4.25v5.5c0 .69-.56 1.25-1.25 1.25H7.5L4.5 13v-2H4.25C3.56 11 3 10.44 3 9.75v-5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function formatBytes(b: number): string {
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

/** Format an ISO datetime as a readable local label, e.g. "Mon 29 Jun, 18:00". */
function formatSlotLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const month = d.toLocaleDateString(undefined, { month: "short" });
  return `${day} ${d.getDate()} ${month}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Resolve the backend provider identifier for a channel. */
function channelIdentifier(c: Channel): string | undefined {
  return c.identifier ?? identifierFromPlatform(c.platform);
}

/** The translate function shape returned by `useT()`. */
type Translate = ReturnType<typeof useT>;

/**
 * Turn any thrown error (ApiError, network failure, validation array) into a
 * friendly, human sentence we can show in the modal.
 */
/**
 * Turn a raw NestJS/class-validator message into something readable: drop the
 * `Posts.0.settings.` field path, Title-case the field name, and hide the
 * internal `__type` discriminator noise (the giant provider list) behind a
 * friendly line.
 */
function cleanValidationMessage(raw: string, t: Translate): string {
  const msg = raw.trim();
  if (msg.includes("__type")) {
    return t("createPost.channelNotSupported");
  }
  // Strip nested field paths like `Posts.0.settings.subject` / `Posts.0.title`.
  let m = msg.replace(/^Posts\.\d+\.(settings\.)?/i, "");
  // Unwrap + Title-case a leading (optionally quoted) field name.
  m = m.replace(/^["']?([a-zA-Z][a-zA-Z0-9_]*)["']?/, (_, field: string) => {
    const spaced = field
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  });
  return capitalizeFirst(m);
}

function humanizeSubmitError(err: unknown, t: Translate): string {
  // Our ApiError carries a parsed `body` which for NestJS validation is
  // usually `{ message: string | string[], statusCode, error }`.
  const anyErr = err as {
    status?: number;
    message?: string;
    body?: unknown;
  };

  const body = anyErr?.body as
    | { message?: unknown; error?: unknown }
    | undefined;

  // class-validator returns an array of messages.
  if (body && Array.isArray(body.message) && body.message.length > 0) {
    return cleanValidationMessage(String(body.message[0]), t);
  }
  if (body && typeof body.message === "string" && body.message.trim()) {
    return cleanValidationMessage(body.message, t);
  }

  // Network / fetch failure (no response).
  if (
    anyErr?.message?.toLowerCase().includes("failed to fetch") ||
    anyErr?.message?.toLowerCase().includes("networkerror")
  ) {
    return t("createPost.networkError");
  }

  if (anyErr?.status === 413) {
    return t("createPost.tooLarge");
  }
  if (anyErr?.status === 429) {
    return t("createPost.tooFast");
  }
  if (anyErr?.status === 402) {
    // Plan limit reached (posts per month / no active plan).
    const section =
      body && typeof body === "object" && "section" in body
        ? String((body as { section?: unknown }).section)
        : "";
    if (section === "posts_per_month") {
      return t("createPost.planLimitPosts");
    }
    return t("createPost.planNotAllowed");
  }
  if (anyErr?.status && anyErr.status >= 500) {
    return t("createPost.serverError");
  }

  if (anyErr?.message && anyErr.message.trim()) {
    return capitalizeFirst(anyErr.message);
  }
  return t("createPost.saveFailed");
}

function capitalizeFirst(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <path
        d="M8 2.6 1.7 13.2a.8.8 0 0 0 .7 1.2h11.2a.8.8 0 0 0 .7-1.2L8 2.6Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 6.6v3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="11.7" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function CreatePostModal({
  channels,
  date,
  time,
  onClose,
  onSaveDraft,
  onSchedule,
  onPublishNow,
  onSendToApproval,
  onDelete,
  initialValue,
  approvalStatus,
  rejectionNote,
}: CreatePostModalProps) {
  const t = useT();
  const isEdit = !!initialValue;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set<string>(initialValue?.channelIds ?? []),
  );

  const [postDate, setPostDate] = useState(initialValue?.date ?? date);
  const [postTime, setPostTime] = useState(initialValue?.time ?? time);

  const [mode, setMode] = useState<"global" | "per-channel">("global");
  /**
   * Active "tab": either the global key or a specific channelId. In global mode it's locked to GLOBAL_KEY.
   * In per-channel mode you switch between channels.
   */
  const [activeTarget, setActiveTarget] = useState<string>(GLOBAL_KEY);

  const [bodies, setBodies] = useState<Record<string, string>>({
    [GLOBAL_KEY]: initialValue?.body ?? "",
  });
  const [threadParts, setThreadParts] = useState<string[]>(
    initialValue?.threadParts ?? [],
  );
  const [media, setMedia] = useState<AttachedMedia[]>(
    initialValue?.media ?? [],
  );

  // Optional first comment (posted right after the main post). Only shown when
  // at least one selected channel's provider supports comments.
  const [firstComment, setFirstComment] = useState("");
  // Provider identifiers (lowercase) that support a first comment, fetched from
  // the backend on mount. Defaults to empty so the field stays hidden until we
  // know the capability set.
  const [commentProviders, setCommentProviders] = useState<string[]>([]);

  // Per-channel provider settings (e.g. Discord requires a server channel).
  // Keyed by integration id → settings object.
  const [channelSettings, setChannelSettings] = useState<
    Record<string, Record<string, unknown>>
  >(initialValue?.perChannelSettings ?? {});
  // Fetched selectable options for remote-select fields, keyed by
  // `integrationId::remoteFn` (e.g. Discord channels, Pinterest boards).
  const [remoteOptions, setRemoteOptions] = useState<
    Record<string, IntegrationChannel[] | undefined>
  >({});
  // TikTok creator info per integration id. Drives the privacy options and the
  // duet/stitch/comment locks — TikTok's audit requires both to come from the
  // account, not from our own hardcoded list.
  const [tiktokCreators, setTiktokCreators] = useState<
    Record<string, TiktokCreatorInfo | undefined>
  >({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Dialog root (focus trap) and the main editor textarea (initial focus).
  const modalRef = useRef<HTMLDivElement | null>(null);
  const mainTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Submit lifecycle: which action is in-flight, and any error to surface.
  const [submitting, setSubmitting] = useState<
    null | "draft" | "schedule" | "now" | "approval"
  >(null);
  // System / backend error (e.g. validation rejected server-side, network).
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set true once the user has attempted to submit, so we reveal the
  // "what's missing" summary even before they fix things.
  const [showValidation, setShowValidation] = useState(false);

  // Post Checker side panel toggle.
  const [showChecker, setShowChecker] = useState(false);

  // Snippets (hashtag groups / caption templates / UTM) side panel toggle.
  const [showSnippets, setShowSnippets] = useState(false);

  // BYO-key AI caption rewrite side panel toggle.
  const [showRewrite, setShowRewrite] = useState(false);

  // Add to queue: fetch the channel's next free slot, then schedule into it.
  const [addingToQueue, setAddingToQueue] = useState(false);
  const [queuePending, setQueuePending] = useState(false);

  // Smart Slots: best-time suggestions for the first selected channel.
  const [slotSuggestions, setSlotSuggestions] = useState<SlotSuggestion[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(false);

  // Focus the main editor once when the modal opens.
  useEffect(() => {
    mainTextareaRef.current?.focus();
  }, []);

  // Unsaved-changes guard + lightweight autosave (new posts only — editing an
  // existing post has its own save/update flow via onSchedule/onSaveDraft,
  // and offering to "restore" over an in-progress edit would be confusing).
  // A single accidental backdrop click or Escape used to silently discard
  // everything typed with zero recovery path.
  //
  // In edit mode the composer is prefilled with the existing post, so "is
  // there any content" is NOT a valid dirty check — it would be true from
  // mount and warn on every close even with zero edits. We snapshot the
  // prefilled state once and compare the current fields against it.
  const initialSnapshot = useMemo(
    () => ({
      body: initialValue?.body ?? "",
      threadParts: initialValue?.threadParts ?? [],
      media: (initialValue?.media ?? []).map((m) => ({
        url: m.url,
        kind: m.kind,
        id: m.id,
      })),
      date: initialValue?.date ?? date,
      time: initialValue?.time ?? time,
      channels: [...(initialValue?.channelIds ?? [])].sort().join(","),
      settings: JSON.stringify(initialValue?.perChannelSettings ?? {}),
    }),
    // initialValue is stable for the modal's lifetime (it never changes while
    // open) and date/time are the props passed at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const hasUnsavedContent = useMemo(() => {
    if (isEdit) {
      // Per-channel bodies are seeded from the global body on mode switch, so
      // compare every body value against the prefilled global body — only a
      // value that DIFFERS from it is a real user edit.
      const bodyDirty =
        (bodies[GLOBAL_KEY] ?? "") !== initialSnapshot.body ||
        Object.values(bodies).some((v) => v !== initialSnapshot.body);
      const threadsDirty =
        threadParts.length !== initialSnapshot.threadParts.length ||
        threadParts.some((p, i) => p !== initialSnapshot.threadParts[i]);
      const mediaDirty =
        media.length !== initialSnapshot.media.length ||
        media.some(
          (m, i) =>
            m.url !== initialSnapshot.media[i]?.url ||
            m.kind !== initialSnapshot.media[i]?.kind,
        );
      const dateDirty = postDate !== initialSnapshot.date;
      const timeDirty = postTime !== initialSnapshot.time;
      const channelsDirty =
        Array.from(selectedIds).sort().join(",") !== initialSnapshot.channels;
      const settingsDirty =
        JSON.stringify(channelSettings) !== initialSnapshot.settings;
      const commentDirty = firstComment.trim().length > 0;
      return (
        bodyDirty ||
        threadsDirty ||
        mediaDirty ||
        dateDirty ||
        timeDirty ||
        channelsDirty ||
        settingsDirty ||
        commentDirty
      );
    }
    // New post: any typed content counts.
    return (
      Object.values(bodies).some((b) => b.trim().length > 0) ||
      threadParts.some((p) => p.trim().length > 0) ||
      media.length > 0
    );
  }, [
    isEdit,
    initialSnapshot,
    bodies,
    threadParts,
    media,
    postDate,
    postTime,
    selectedIds,
    channelSettings,
    firstComment,
  ]);

  const DRAFT_KEY = "postsider:composer:draft";

  // Restore-on-mount: only for a brand-new post, only once.
  useEffect(() => {
    if (isEdit) return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        bodies?: Record<string, string>;
        threadParts?: string[];
        selectedIds?: string[];
      };
      const hasContent =
        Object.values(saved.bodies ?? {}).some((b) => b.trim()) ||
        (saved.threadParts ?? []).some((p) => p.trim());
      if (!hasContent) return;
      if (window.confirm(t("createPost.restoreDraftConfirm"))) {
        if (saved.bodies) setBodies(saved.bodies);
        if (saved.threadParts) setThreadParts(saved.threadParts);
        if (saved.selectedIds) setSelectedIds(new Set(saved.selectedIds));
      } else {
        window.localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // Corrupt/inaccessible storage — not worth surfacing, just skip restore.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave (new posts only). Media isn't persisted (object URLs
  // don't survive a reload anyway) — text is the expensive-to-retype part.
  useEffect(() => {
    if (isEdit) return;
    const handle = window.setTimeout(() => {
      try {
        if (hasUnsavedContent) {
          window.localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({
              bodies,
              threadParts,
              selectedIds: Array.from(selectedIds),
            }),
          );
        }
      } catch {
        // Storage full/unavailable — autosave is best-effort, never blocking.
      }
    }, 800);
    return () => window.clearTimeout(handle);
  }, [isEdit, bodies, threadParts, selectedIds, hasUnsavedContent]);

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Best-effort.
    }
  };

  const requestClose = useCallback(() => {
    if (
      hasUnsavedContent &&
      !window.confirm(t("createPost.discardChangesConfirm"))
    ) {
      return;
    }
    onClose();
  }, [hasUnsavedContent, onClose, t]);

  // Warn on tab close/refresh too — the composer is otherwise silently gone.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedContent) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedContent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        requestClose();
        return;
      }
      // Simple focus trap: keep Tab / Shift+Tab cycling inside the dialog.
      if (e.key === "Tab") {
        const root = modalRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !root.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [requestClose]);

  // Fetch which providers support a first comment. Errors stay quiet: the
  // field simply doesn't appear if we can't load the capability list.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await getCommentProviders();
        if (!cancelled) {
          setCommentProviders(
            (res?.providers ?? []).map((p) => p.toLowerCase()),
          );
        }
      } catch {
        // ignore — keep the field hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Clean up object URLs when modal closes. Track the latest media in a ref so
  // the unmount cleanup revokes everything attached during the session — an
  // empty-deps effect would close over the initial (empty) media array and leak
  // every blob added afterwards.
  const mediaRef = useRef<AttachedMedia[]>([]);
  mediaRef.current = media;
  useEffect(() => {
    return () => {
      for (const m of mediaRef.current) {
        try {
          URL.revokeObjectURL(m.url);
        } catch {}
      }
    };
  }, []);

  const toggleChannel = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (activeTarget === id) setActiveTarget(GLOBAL_KEY);
      } else {
        next.add(id);
      }
      return next;
    });

  const selectedChannels = useMemo(
    () => channels.filter((c) => selectedIds.has(c.id)),
    [channels, selectedIds],
  );

  // True when at least one selected channel's provider supports a first
  // comment. Compared case-insensitively against the fetched capability list.
  const anySelectedSupportsComment = useMemo(() => {
    if (commentProviders.length === 0) return false;
    return selectedChannels.some((c) => {
      const id = channelIdentifier(c);
      return !!id && commentProviders.includes(id.toLowerCase());
    });
  }, [selectedChannels, commentProviders]);

  // Smart Slots: fetch best-time suggestions for the first selected channel.
  const fetchSlots = useCallback(async () => {
    const channel = selectedChannels[0];
    const platform = channel ? channelIdentifier(channel) : undefined;
    if (!channel || !platform) return;
    setSlotsLoading(true);
    setSlotsError(false);
    try {
      const slots = await suggestSlots(channel.id, platform, 3);
      setSlotSuggestions(Array.isArray(slots) ? slots : []);
    } catch {
      setSlotSuggestions([]);
      setSlotsError(true);
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedChannels]);

  // Apply a suggestion: convert its ISO datetime to the local YYYY-MM-DD +
  // HH:mm strings the pickers expect, reusing the existing date/time setters.
  const applySlot = useCallback((slot: SlotSuggestion) => {
    const d = new Date(slot.datetime);
    if (Number.isNaN(d.getTime())) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    setPostDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    setPostTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }, []);

  // Provider requirement per selected channel (memoised by identifier).
  const requirementFor = useCallback(
    (c: Channel): ProviderRequirement =>
      getProviderRequirement(channelIdentifier(c)),
    [],
  );

  // Fetch options for any remote-select field (Discord channels, Pinterest
  // boards, subreddits, …) of the currently selected channels that we haven't
  // loaded yet. Keyed by `integrationId::remoteFn`.
  // Using a ref to track in-flight keys avoids re-running the effect on every
  // state update to remoteOptions (which would cause a cascade).
  const fetchedKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    for (const c of selectedChannels) {
      const req = requirementFor(c);
      for (const field of req.fields) {
        if (field.type !== "remote-select" || !field.remoteFn) continue;
        // Dependent remote-selects (e.g. the Whop forum depends on the chosen
        // company) pass the parent field's value as the `id` param. Skip until
        // the parent value exists; the param-aware key means changing it
        // triggers a fresh fetch and switching back reuses the cached list.
        const paramVal = field.remoteParam
          ? (channelSettings[c.id]?.[field.remoteParam] as string | undefined)
          : undefined;
        if (field.remoteParam && !paramVal) continue;
        const key = `${c.id}::${field.remoteFn}::${paramVal ?? ""}`;
        if (fetchedKeysRef.current.has(key)) continue;
        fetchedKeysRef.current.add(key);
        const remoteFn = field.remoteFn;
        void (async () => {
          const list = await getIntegrationChannels(
            c.id,
            remoteFn,
            paramVal ? { id: paramVal } : {},
          );
          if (!cancelled) {
            setRemoteOptions((prev) => ({ ...prev, [key]: list }));
          } else {
            // Effect re-ran before this resolved; drop the key so a later run
            // re-fetches instead of stranding the dropdown on "Loading…".
            fetchedKeysRef.current.delete(key);
          }
        })();
      }
    }
    return () => {
      cancelled = true;
    };
  }, [selectedChannels, requirementFor, channelSettings]);

  // Load TikTok creator info once per selected TikTok channel. Everything the
  // composer offers for TikTok (allowed privacy levels, whether duet/stitch/
  // comments may be enabled) has to come from the account itself — offering a
  // public option to a private account, or a duet switch to a creator who
  // turned duets off, is exactly what the Content Posting API audit rejects.
  const tiktokFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    for (const c of selectedChannels) {
      if (channelIdentifier(c) !== "tiktok") continue;
      if (tiktokFetchedRef.current.has(c.id)) continue;
      tiktokFetchedRef.current.add(c.id);
      void (async () => {
        try {
          const info = await getTiktokCreatorInfo(c.id);
          if (!cancelled) {
            setTiktokCreators((prev) => ({ ...prev, [c.id]: info }));
          } else {
            tiktokFetchedRef.current.delete(c.id);
          }
        } catch {
          // Leave it undefined: the panel then shows "couldn't load" and keeps
          // the privacy picker empty rather than falling back to a guessed
          // public default.
          tiktokFetchedRef.current.delete(c.id);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [selectedChannels]);

  // Drop a privacy level the account doesn't actually allow (e.g. a post
  // prefilled as public for an account that has since gone private), so it can
  // never be submitted just because it was set earlier.
  useEffect(() => {
    setChannelSettings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, info] of Object.entries(tiktokCreators)) {
        const current = next[id]?.privacy_level as string | undefined;
        if (!info || !current) continue;
        if (!info.privacyOptions.includes(current)) {
          const { privacy_level: _dropped, ...rest } = next[id]!;
          next[id] = rest;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tiktokCreators]);

  // Seed default provider settings for selected channels so required DTO
  // fields (e.g. TikTok privacy_level, Instagram post_type) are always present
  // and the post passes server-side validation.
  useEffect(() => {
    setChannelSettings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of selectedChannels) {
        const defaults = defaultSettingsFor(channelIdentifier(c));
        if (Object.keys(defaults).length === 0) continue;
        const existing = next[c.id] ?? {};
        const merged = { ...defaults, ...existing };
        if (Object.keys(merged).length !== Object.keys(existing).length) {
          next[c.id] = merged;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedChannels]);

  const setChannelSetting = (
    integrationId: string,
    key: string,
    value: unknown,
  ) => {
    setChannelSettings((prev) => {
      const next = { ...(prev[integrationId] ?? {}), [key]: value };
      // Drop any dependent remote-select whose parent (`remoteParam`) just
      // changed, so a stale child (e.g. a forum from a different Whop company)
      // isn't kept selected.
      const channel = selectedChannels.find((c) => c.id === integrationId);
      if (channel) {
        for (const f of requirementFor(channel).fields) {
          if (f.type === "remote-select" && f.remoteParam === key) {
            delete next[f.key];
          }
        }
      }
      return { ...prev, [integrationId]: next };
    });
  };

  // When entering per-channel mode, seed empty per-channel bodies from the global body.
  const switchMode = (next: "global" | "per-channel") => {
    if (next === mode) return;
    setMode(next);
    if (next === "per-channel") {
      setBodies((prev) => {
        const seeded: Record<string, string> = { ...prev };
        for (const c of selectedChannels) {
          if (seeded[c.id] === undefined) seeded[c.id] = prev[GLOBAL_KEY] ?? "";
        }
        return seeded;
      });
      setActiveTarget(selectedChannels[0]?.id ?? GLOBAL_KEY);
    } else {
      setActiveTarget(GLOBAL_KEY);
    }
  };

  const currentBody =
    mode === "global"
      ? bodies[GLOBAL_KEY] ?? ""
      : bodies[activeTarget] ?? "";

  const setCurrentBody = (value: string) => {
    setBodies((prev) => ({ ...prev, [activeTarget]: value }));
  };

  // Snippets panel: append saved text, or apply a UTM preset to the body's URLs.
  const insertSnippetText = (text: string) => {
    setCurrentBody(currentBody ? `${currentBody.replace(/\s+$/, "")}\n\n${text}` : text);
  };
  const applyUtmPreset = (preset: UtmPreset) => {
    setCurrentBody(appendUtmParams(currentBody, preset));
  };
  const openSnippets = () => {
    setShowChecker(false);
    setShowRewrite(false);
    setShowSnippets(true);
  };
  const openRewrite = () => {
    setShowChecker(false);
    setShowSnippets(false);
    setShowRewrite(true);
  };

  const onPickMedia = () => fileInputRef.current?.click();

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const next: AttachedMedia[] = [];
    for (const f of Array.from(files)) {
      const kind: "image" | "video" = f.type.startsWith("video")
        ? "video"
        : "image";
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        kind,
        size: f.size,
        url: URL.createObjectURL(f),
      });
    }
    setMedia((prev) => [...prev, ...next]);
    e.target.value = ""; // allow picking the same file again
  };

  const removeMedia = (id: string) => {
    setMedia((prev) => {
      const dropped = prev.find((m) => m.id === id);
      if (dropped) {
        try {
          URL.revokeObjectURL(dropped.url);
        } catch {}
      }
      return prev.filter((m) => m.id !== id);
    });
  };

  // Carousel order matters on Instagram/LinkedIn/X — swapping images used to
  // require delete-and-re-add, which silently put the re-added image LAST.
  const moveMedia = (id: string, direction: -1 | 1) => {
    setMedia((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      const swapWith = idx + direction;
      if (idx === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  };

  const addThreadPart = () => setThreadParts((prev) => [...prev, ""]);
  const updateThreadPart = (i: number, value: string) =>
    setThreadParts((prev) => prev.map((p, idx) => (idx === i ? value : p)));
  const removeThreadPart = (i: number) =>
    setThreadParts((prev) => prev.filter((_, idx) => idx !== i));

  const buildPost = useCallback((): NewPostInput => {
    const globalBody = bodies[GLOBAL_KEY] ?? "";
    const perChannelBody: Record<string, string> = {};
    if (mode === "per-channel") {
      for (const c of selectedChannels) {
        const value = bodies[c.id];
        if (value !== undefined && value.trim().length > 0) {
          perChannelBody[c.id] = value;
        }
      }
    }
    const referenceBody =
      mode === "global"
        ? globalBody
        : perChannelBody[selectedChannels[0]?.id ?? ""] ?? globalBody;
    return {
      channelIds: Array.from(selectedIds),
      date: postDate,
      time: postTime,
      title: referenceBody.split("\n")[0].slice(0, 60) || "Untitled",
      body: globalBody || referenceBody,
      perChannelBody,
      threadParts: threadParts.filter((p) => p.trim().length > 0),
      firstComment: firstComment.trim() || undefined,
      media,
      perChannelSettings: channelSettings,
    };
  }, [
    bodies,
    mode,
    selectedChannels,
    selectedIds,
    postDate,
    postTime,
    threadParts,
    firstComment,
    media,
    channelSettings,
  ]);

  // Body text used for a given channel (per-channel override or global).
  const bodyForChannel = useCallback(
    (channelId: string): string => {
      if (mode === "global") return bodies[GLOBAL_KEY] ?? "";
      return bodies[channelId] ?? bodies[GLOBAL_KEY] ?? "";
    },
    [bodies, mode],
  );

  // Media in the shape the provider validators expect.
  const mediaLike = useMemo<MediaLike[]>(
    () => media.map((m) => ({ kind: m.kind })),
    [media],
  );

  const commentsHaveMedia = false; // composer only attaches media to the main post

  // --- Post Checker inputs (derived from existing composer state) ---
  // Combined editor text: global body plus any thread parts.
  const checkerContent = useMemo(() => {
    const main = bodies[GLOBAL_KEY] ?? "";
    return [main, ...threadParts].filter((p) => p.trim().length > 0).join("\n\n");
  }, [bodies, threadParts]);

  const checkerMediaType = useMemo<"image" | "video" | "mixed" | undefined>(() => {
    if (media.length === 0) return undefined;
    const hasImage = media.some((m) => m.kind === "image");
    const hasVideo = media.some((m) => m.kind === "video");
    if (hasImage && hasVideo) return "mixed";
    return hasImage ? "image" : "video";
  }, [media]);

  const checkerPlatforms = useMemo(
    () =>
      Array.from(
        new Set(
          selectedChannels
            .map((c) => channelIdentifier(c))
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    [selectedChannels],
  );

  // Run each selected channel's provider validation. Returns a map of
  // channelId → list of human-readable problems (empty list = valid).
  const channelProblems = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const c of selectedChannels) {
      const req = requirementFor(c);
      const body = bodyForChannel(c.id);
      const problems = [...req.validate({
        media: mediaLike,
        settings: channelSettings[c.id] ?? {},
        body,
        commentsHaveMedia,
      })];
      // Generic length check (mirrors maxLength on the backend providers).
      const maxLen = effectiveMaxLength(req, { verified: c.verified });
      if (body.length > maxLen) {
        problems.push(
          t("createPost.contentTooLong", {
            channel: req.label,
            max: maxLen,
          }),
        );
      }
      // Required settings fields that are still empty.
      for (const field of req.fields) {
        if (!field.required) continue;
        if (field.showIf && !field.showIf(channelSettings[c.id] ?? {})) continue;
        const v = (channelSettings[c.id] ?? {})[field.key];
        const empty =
          v === undefined ||
          v === null ||
          (typeof v === "string" && v.trim() === "") ||
          (Array.isArray(v) && v.length === 0);
        if (empty && !problems.some((p) => p.toLowerCase().includes(field.label.toLowerCase()))) {
          problems.push(
            t("createPost.fieldRequired", {
              field: field.label,
              channel: req.label,
            }),
          );
        }
      }
      if (problems.length > 0) out[c.id] = problems;
    }
    return out;
  }, [
    selectedChannels,
    requirementFor,
    bodyForChannel,
    mediaLike,
    channelSettings,
    t,
  ]);

  // A flat, human summary of everything the user still needs to fix before the
  // post can go out. Grouped by channel so the message is actionable.
  const validationSummary = useMemo<
    { channel: Channel; problems: string[] }[]
  >(() => {
    const out: { channel: Channel; problems: string[] }[] = [];
    for (const c of selectedChannels) {
      const list: string[] = [];
      // Missing content is the most common omission.
      if ((bodyForChannel(c.id) ?? "").trim().length === 0) {
        list.push(t("createPost.addTextForChannel"));
      }
      list.push(...(channelProblems[c.id] ?? []));
      if (list.length > 0) out.push({ channel: c, problems: list });
    }
    return out;
  }, [selectedChannels, bodyForChannel, channelProblems, t]);

  // Once the user resolves every gap, drop the "almost there" banner so it
  // doesn't linger. We keep `showValidation` itself so it can re-trigger.
  useEffect(() => {
    if (showValidation && validationSummary.length === 0) {
      setShowValidation(false);
    }
  }, [showValidation, validationSummary.length]);

  // state, surfaces user-input gaps, and turns backend failures into a
  // friendly banner instead of an unhandled rejection.
  const runSubmit = useCallback(
    async (
      kind: "draft" | "schedule" | "now" | "approval",
      handler?: (post: NewPostInput) => void | Promise<void>,
    ) => {
      if (!handler) return;
      setSubmitError(null);

      // Drafts are allowed to be incomplete; scheduling / publishing aren't.
      if (kind !== "draft") {
        setShowValidation(true);
        if (selectedIds.size === 0) {
          setSubmitError(t("createPost.pickChannel"));
          return;
        }
        if (validationSummary.length > 0) {
          // The inline per-channel panels already show the details; nudge the
          // user toward them with a single friendly line.
          setSubmitError(
            t("createPost.attentionNeeded"),
          );
          return;
        }
      } else if (selectedIds.size === 0) {
        setSubmitError(t("createPost.pickDraft"));
        return;
      }

      setSubmitting(kind);
      try {
        await handler(buildPost());
        // Parent closes the modal on success; nothing else to do here.
        clearDraft();
      } catch (err) {
        console.error("[submit-post]", err);
        setSubmitError(humanizeSubmitError(err, t));
        setSubmitting(null);
      }
    },
    [buildPost, selectedIds.size, validationSummary.length, t],
  );

  // Add to queue: drop the post into this channel's next free posting slot,
  // then schedule it. Single-channel only for v1 (per-channel slots differ).
  const addToQueue = useCallback(async () => {
    if (selectedChannels.length !== 1) return;
    setAddingToQueue(true);
    setSubmitError(null);
    try {
      const { date } = await findNextSlot(selectedChannels[0].id);
      // find-slot returns a UTC wall-clock string without a zone (same as the
      // value Evergreen reuses with "+ 'Z'"). Treat it as UTC, then feed the
      // pickers the LOCAL representation so the composer's local->UTC submit
      // (new Date(`${date}T${time}`).toISOString()) round-trips to the slot.
      const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(date);
      const d = new Date(hasZone ? date : date + "Z");
      if (Number.isNaN(d.getTime())) throw new Error("Invalid slot");
      const pad = (n: number) => String(n).padStart(2, "0");
      setPostDate(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      );
      setPostTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      // Defer the submit so it runs after postDate/postTime have updated.
      setQueuePending(true);
    } catch (err) {
      setSubmitError(humanizeSubmitError(err, t));
      setAddingToQueue(false);
    }
  }, [selectedChannels, t]);

  useEffect(() => {
    if (!queuePending) return;
    setQueuePending(false);
    setAddingToQueue(false);
    void runSubmit("schedule", onSchedule);
  }, [queuePending, runSubmit, onSchedule]);

  // Preview: in global mode, every channel renders the same body. In per-channel,
  // each renders its own override.
  const previewContent = (channelId: string): string => {
    if (mode === "global") return bodies[GLOBAL_KEY] ?? "";
    return bodies[channelId] ?? "";
  };

  const placeholder =
    mode === "global"
      ? t("createPost.placeholderGlobal")
      : t("createPost.placeholderChannel", {
          channel:
            channels.find((c) => c.id === activeTarget)?.name ??
            t("createPost.thisChannel"),
        });

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Create post"
      onClick={requestClose}
    >
      <div
        ref={modalRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <span className={styles.title}>
            {isEdit ? t("createPost.editTitle") : t("createPost.title")}
          </span>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={requestClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div
          className={`${styles.body} ${showChecker || showSnippets || showRewrite ? styles.bodyWithChecker : ""}`}
        >
          <section className={styles.editor}>
            {approvalStatus === "rejected" && (
              <div
                role="alert"
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "rgba(220,38,38,0.06)",
                  border: "1px solid rgba(220,38,38,0.2)",
                  color: "#DC2626",
                  fontSize: 13,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginBottom: 12,
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {t("createPost.rejectedTitle")}
                </span>
                <span style={{ opacity: 0.85 }}>
                  {rejectionNote
                    ? t("createPost.rejectedWithNote", { note: rejectionNote })
                    : t("createPost.rejectedNoNote")}
                </span>
                <span style={{ opacity: 0.7 }}>
                  {t("createPost.editAndResubmit")}
                </span>
              </div>
            )}
            {approvalStatus === "pending" && (
              <div
                role="status"
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "rgba(245,158,11,0.06)",
                  border: "1px solid rgba(245,158,11,0.25)",
                  color: "#D97706",
                  fontSize: 13,
                  marginBottom: 12,
                }}
              >
                {t("createPost.pendingApprovalBanner")}
              </div>
            )}
            {submitError && (
              <div className={styles.submitError} role="alert">
                <span className={styles.submitErrorIcon} aria-hidden>
                  <WarnIcon />
                </span>
                <span>{submitError}</span>
                <button
                  type="button"
                  className={styles.submitErrorClose}
                  onClick={() => setSubmitError(null)}
                  aria-label="Dismiss"
                >
                  <CloseIcon />
                </button>
              </div>
            )}

            {showValidation && validationSummary.length > 0 && (
              <div className={styles.validationSummary} role="status">
                <div className={styles.validationSummaryHead}>
                  <WarnIcon />
                  <span>{t("createPost.almostThere")}</span>
                </div>
                <ul className={styles.validationList}>
                  {validationSummary.map(({ channel, problems }) => (
                    <li key={channel.id} className={styles.validationItem}>
                      <span className={styles.validationChannel}>
                        {channel.name}
                        <span className={styles.validationChannelPlatform}>
                          {" · "}
                          {channel.platform}
                        </span>
                      </span>
                      <ul className={styles.validationSubList}>
                        {problems.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ChannelStrip
              channels={channels}
              selectedIds={selectedIds}
              onToggle={toggleChannel}
              activeTarget={activeTarget}
              onActivateChannel={(id) => {
                if (mode === "per-channel") setActiveTarget(id);
              }}
              mode={mode}
            />

            <div className={styles.modeRow}>
              <div className={styles.modeTabs} role="tablist" aria-label="Write mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "global"}
                  className={
                    styles.modeTab +
                    (mode === "global" ? " " + styles.modeTabActive : "")
                  }
                  onClick={() => switchMode("global")}
                >
                  {t("createPost.globalWrite")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "per-channel"}
                  disabled={selectedIds.size === 0}
                  className={
                    styles.modeTab +
                    (mode === "per-channel"
                      ? " " + styles.modeTabActive
                      : "")
                  }
                  onClick={() => switchMode("per-channel")}
                >
                  {t("createPost.perChannel")}
                </button>
              </div>
              {/* Outside the tablist: InfoTip isn't a tab, and ARIA tablist
                  children are expected to all be role="tab". */}
              <InfoTip textKey="infoTip.globalWrite" />

              {mode === "per-channel" && (
                <div className={styles.targetTabs} role="tablist">
                  {selectedChannels.map((c) => (
                    <button
                      type="button"
                      role="tab"
                      key={c.id}
                      aria-selected={activeTarget === c.id}
                      className={
                        styles.targetTab +
                        (activeTarget === c.id
                          ? " " + styles.targetTabActive
                          : "")
                      }
                      onClick={() => setActiveTarget(c.id)}
                      title={`${c.name} · ${c.platform}`}
                    >
                      <ChannelAvatar
                        channel={c}
                        size={20}
                        circular
                        showPlatformBadge={false}
                      />
                      <span className={styles.targetTabName}>{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <textarea
              ref={mainTextareaRef}
              value={currentBody}
              onChange={(e) => setCurrentBody(e.target.value)}
              placeholder={placeholder}
              className={styles.textarea}
              rows={8}
            />

            {anySelectedSupportsComment && (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  {t("firstComment.label")}
                  <InfoTip textKey="infoTip.firstComment" />
                </label>
                <textarea
                  value={firstComment}
                  onChange={(e) => setFirstComment(e.target.value)}
                  placeholder={t("firstComment.placeholder")}
                  className={styles.fieldTextarea}
                  rows={2}
                />
                <span className={styles.fieldHelp}>
                  {t("firstComment.hint")}
                </span>
              </div>
            )}

            {/*
              Provider-specific requirements & settings. In per-channel mode we
              show the active channel's panel; in global mode we show a panel
              for every selected channel that has settings or warnings.
            */}
            {(mode === "per-channel"
              ? selectedChannels.filter((c) => c.id === activeTarget)
              : selectedChannels
            ).map((c) => (
              <ProviderSettingsPanel
                key={c.id}
                channel={c}
                requirement={requirementFor(c)}
                settings={channelSettings[c.id] ?? {}}
                problems={channelProblems[c.id] ?? []}
                remoteOptions={remoteOptions}
                creatorInfo={tiktokCreators[c.id]}
                bodyLength={bodyForChannel(c.id).length}
                onChange={(key, value) => setChannelSetting(c.id, key, value)}
              />
            ))}

            {media.length > 0 && (
              <div className={styles.mediaList}>
                {media.map((m, i) => (
                  <div key={m.id} className={styles.mediaItem}>
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.url}
                        alt=""
                        className={styles.mediaThumb}
                      />
                    ) : (
                      <video
                        src={m.url}
                        muted
                        playsInline
                        className={styles.mediaThumb}
                      />
                    )}
                    <div className={styles.mediaMeta}>
                      <span className={styles.mediaName}>{m.name}</span>
                      <span className={styles.mediaSize}>
                        {m.kind === "image" ? "Image" : "Video"} · {formatBytes(m.size)}
                      </span>
                    </div>
                    {media.length > 1 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <button
                          type="button"
                          className={styles.mediaRemove}
                          onClick={() => moveMedia(m.id, -1)}
                          disabled={i === 0}
                          aria-label={t("createPost.moveMediaUp")}
                          style={{ opacity: i === 0 ? 0.3 : 1 }}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className={styles.mediaRemove}
                          onClick={() => moveMedia(m.id, 1)}
                          disabled={i === media.length - 1}
                          aria-label={t("createPost.moveMediaDown")}
                          style={{ opacity: i === media.length - 1 ? 0.3 : 1 }}
                        >
                          ▼
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className={styles.mediaRemove}
                      onClick={() => removeMedia(m.id)}
                      aria-label={`Remove ${m.name}`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.toolbar}>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={onPickMedia}
              >
                <ImageIcon />
                {t("createPost.addImage")}
              </button>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={onPickMedia}
              >
                <VideoIcon />
                {t("createPost.addVideo")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                style={{ display: "none" }}
                onChange={onFiles}
              />
              <button
                type="button"
                className={styles.toolBtn}
                onClick={addThreadPart}
              >
                <CommentIcon />
                {t("createPost.addComment")}
              </button>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={openSnippets}
              >
                # {t("createPost.snippets")}
              </button>
            </div>

            {threadParts.length > 0 && (
              <div className={styles.threadList}>
                {threadParts.map((part, i) => (
                  <div key={i} className={styles.threadItem}>
                    <span className={styles.threadIndex}>↳ {i + 1}</span>
                    <textarea
                      value={part}
                      onChange={(e) => updateThreadPart(i, e.target.value)}
                      placeholder={t("createPost.threadPlaceholder")}
                      className={styles.threadTextarea}
                      rows={2}
                    />
                    <button
                      type="button"
                      className={styles.threadRemove}
                      onClick={() => removeThreadPart(i)}
                      aria-label="Remove this part"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className={styles.preview}>
            <span className={styles.previewLabel}>
              {t("createPost.postPreview")}
            </span>
            <PostPreviewPanel
              channels={selectedChannels}
              activeTarget={activeTarget}
              bodyFor={previewContent}
              media={media}
              threadParts={threadParts}
              maxLenFor={(c) =>
                effectiveMaxLength(requirementFor(c), { verified: c.verified })
              }
              identifierFor={(c) => channelIdentifier(c)}
            />
          </aside>

          {showChecker && (
            <div className={styles.checkerSlot}>
              <PostCheckerPanel
                content={checkerContent}
                hasMedia={media.length > 0}
                mediaType={checkerMediaType}
                platforms={checkerPlatforms}
                onClose={() => setShowChecker(false)}
              />
            </div>
          )}

          {showSnippets && (
            <div className={styles.checkerSlot}>
              <SnippetsPanel
                selectedPlatforms={checkerPlatforms}
                onInsertText={insertSnippetText}
                onApplyUtm={applyUtmPreset}
                onClose={() => setShowSnippets(false)}
              />
            </div>
          )}

          {showRewrite && (
            <div className={styles.checkerSlot}>
              <RewritePanel
                content={currentBody}
                platform={checkerPlatforms[0]}
                onInsert={(v) => { setCurrentBody(v); setShowRewrite(false); }}
                onClose={() => setShowRewrite(false)}
              />
            </div>
          )}
        </div>

        <footer className={styles.foot}>
          <div className={styles.footLeft}>
            <DatePicker value={postDate} onChange={setPostDate} />
            <TimePicker value={postTime} onChange={setPostTime} />
          </div>
          <div className={styles.smartSlots}>
            <button
              type="button"
              className={styles.smartSlotsBtn}
              disabled={selectedChannels.length === 0 || slotsLoading}
              onClick={fetchSlots}
            >
              {slotsLoading
                ? t("smartSlots.suggesting")
                : `✦ ${t("smartSlots.suggest")}`}
            </button>
            {!slotsLoading && slotSuggestions.length > 0 && (
              <>
                <div className={styles.smartSlotsChips}>
                  {slotSuggestions.slice(0, 3).map((slot) => (
                    <button
                      key={slot.datetime}
                      type="button"
                      className={styles.smartSlotChip}
                      onClick={() => applySlot(slot)}
                    >
                      {formatSlotLabel(slot.datetime)}
                    </button>
                  ))}
                </div>
                <span className={styles.smartSlotsHint}>
                  {t("smartSlots.reason")}
                </span>
              </>
            )}
            {!slotsLoading && slotsError && (
              <span className={styles.smartSlotsHint}>
                {t("smartSlots.none")}
              </span>
            )}
          </div>
          <div className={styles.footRight}>
            {isEdit && onDelete && (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={submitting !== null}
                onClick={onDelete}
              >
                {t("common.delete")}
              </button>
            )}
            {!isEdit && (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={submitting !== null}
                onClick={() => runSubmit("draft", onSaveDraft)}
              >
                {submitting === "draft"
                  ? t("createPost.saving")
                  : t("createPost.saveDraft")}
              </button>
            )}
            {!isEdit && onSendToApproval && (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={submitting !== null}
                onClick={() => runSubmit("approval", onSendToApproval)}
              >
                {submitting === "approval"
                  ? t("createPost.sending")
                  : t("createPost.sendToApproval")}
              </button>
            )}
            {onPublishNow && (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={submitting !== null}
                onClick={() => runSubmit("now", onPublishNow)}
              >
                {submitting === "now"
                  ? t("createPost.publishing")
                  : t("createPost.publishNow")}
              </button>
            )}
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={submitting !== null || checkerPlatforms.length === 0}
              onClick={() => { setShowSnippets(false); setShowRewrite(false); setShowChecker(true); }}
            >
              ✦ {t("postChecker.checkPost")}
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={submitting !== null || currentBody.trim().length === 0}
              onClick={openRewrite}
            >
              ✎ {t("createPost.rewrite")}
            </button>
            {selectedChannels.length === 1 && (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={submitting !== null || addingToQueue}
                onClick={addToQueue}
              >
                {addingToQueue
                  ? t("createPost.addingToQueue")
                  : t("createPost.addToQueue")}
              </button>
            )}
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={submitting !== null}
              onClick={() => runSubmit("schedule", onSchedule)}
            >
              {submitting === "schedule"
                ? t("createPost.saving")
                : isEdit
                  ? t("createPost.update")
                  : t("createPost.schedule")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

interface ChannelStripProps {
  channels: Channel[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  activeTarget: string;
  onActivateChannel: (id: string) => void;
  mode: "global" | "per-channel";
}

function ChannelStrip({
  channels,
  selectedIds,
  onToggle,
  activeTarget,
  onActivateChannel,
  mode,
}: ChannelStripProps) {
  return (
    <div className={styles.channelStrip}>
      {channels.map((c) => {
        const on = selectedIds.has(c.id);
        const active = mode === "per-channel" && activeTarget === c.id;
        return (
          <button
            type="button"
            key={c.id}
            className={
              styles.channelChip +
              (on ? " " + styles.channelChipOn : "") +
              (active ? " " + styles.channelChipActive : "")
            }
            onClick={() => {
              if (!on) {
                onToggle(c.id);
              } else if (mode === "per-channel") {
                onActivateChannel(c.id);
              } else {
                onToggle(c.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onToggle(c.id);
            }}
            title={`${c.name} · ${c.platform}${
              on ? " · click to " + (mode === "per-channel" ? "edit" : "remove") : " · click to add"
            }`}
            aria-pressed={on}
          >
            <ChannelAvatar
              channel={c}
              size={44}
              circular
              showPlatformBadge
              inverted={!on}
            />
            <span className={styles.channelChipName}>{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Provider settings & warnings                      */
/* -------------------------------------------------------------------------- */

interface ProviderSettingsPanelProps {
  channel: Channel;
  requirement: ProviderRequirement;
  settings: Record<string, unknown>;
  problems: string[];
  /** Remote-select options keyed by `integrationId::remoteFn`. */
  remoteOptions: Record<string, IntegrationChannel[] | undefined>;
  /** TikTok only: what the connected account allows. */
  creatorInfo?: TiktokCreatorInfo;
  /** Current body length for this channel (for the character counter). */
  bodyLength: number;
  onChange: (key: string, value: unknown) => void;
}

/**
 * Renders a provider's media note, any blocking warnings, and the
 * provider-specific settings fields (auto-generated from the requirement).
 */
function ProviderSettingsPanel({
  channel,
  requirement,
  settings,
  problems,
  remoteOptions,
  creatorInfo,
  bodyLength,
  onChange,
}: ProviderSettingsPanelProps) {
  const t = useT();
  const visibleFields = requirement.fields.filter(
    (f) => !f.showIf || f.showIf(settings),
  );
  const isTiktok = requirement.identifier === "tiktok";
  const commercial =
    Boolean(settings.brand_content_toggle) ||
    Boolean(settings.brand_organic_toggle);

  const maxLen = effectiveMaxLength(requirement, { verified: channel.verified });
  const overLimit = bodyLength > maxLen;

  // Show the panel when there's something useful to display: a media note,
  // warnings, settings fields, or a "tight" character limit worth surfacing.
  const hasContent =
    !!requirement.mediaNote ||
    problems.length > 0 ||
    visibleFields.length > 0 ||
    maxLen <= 5000;
  if (!hasContent) return null;

  return (
    <div className={styles.providerPanel}>
      <div className={styles.providerPanelHead}>
        <ChannelAvatar
          channel={channel}
          size={20}
          circular
          showPlatformBadge={false}
        />
        <span className={styles.providerPanelTitle}>
          {requirement.label} settings
        </span>
        <span
          className={
            styles.providerCounter +
            (overLimit ? " " + styles.providerCounterOver : "")
          }
        >
          {bodyLength.toLocaleString()} / {maxLen.toLocaleString()}
        </span>
      </div>

      {requirement.mediaNote && problems.length === 0 && (
        <div className={styles.providerHint}>
          <WarnIcon />
          <span>{requirement.mediaNote}</span>
        </div>
      )}

      {problems.length > 0 && (
        <div className={styles.providerWarning}>
          <WarnIcon />
          <div>
            {problems.map((p, i) => (
              <div key={i}>{p}</div>
            ))}
          </div>
        </div>
      )}

      {isTiktok && !creatorInfo && (
        <div className={styles.providerHint}>
          <WarnIcon />
          <span>{t("createPost.tiktok.loadingCreator")}</span>
        </div>
      )}

      {visibleFields.length > 0 && (
        <div className={styles.providerFields}>
          {visibleFields.map((field) => (
            <ProviderField
              key={field.key}
              channelId={channel.id}
              field={field}
              value={settings[field.key]}
              remoteParamValue={
                field.remoteParam
                  ? (settings[field.remoteParam] as string | undefined)
                  : undefined
              }
              remoteOptions={remoteOptions}
              creatorInfo={creatorInfo}
              onChange={(value) => onChange(field.key, value)}
            />
          ))}
        </div>
      )}

      {/*
        Required by TikTok's content-sharing guidelines: the creator has to see,
        at posting time, which policies they are agreeing to and how commercial
        content will be labelled. Wording follows TikTok's own required copy.
      */}
      {isTiktok && (
        <div className={styles.providerHint}>
          <span>
            {commercial && (
              <>
                {Boolean(settings.brand_content_toggle)
                  ? t("createPost.tiktok.labelPaidPartnership")
                  : t("createPost.tiktok.labelPromotional")}{" "}
              </>
            )}
            {commercial
              ? t("createPost.tiktok.consentBranded")
              : t("createPost.tiktok.consentMusic")}{" "}
            <a
              href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("createPost.tiktok.musicPolicy")}
            </a>
            {commercial && (
              <>
                {" · "}
                <a
                  href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("createPost.tiktok.brandedPolicy")}
                </a>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

interface ProviderFieldProps {
  channelId: string;
  field: SettingsField;
  value: unknown;
  /** For a dependent remote-select: the current value of its `remoteParam`. */
  remoteParamValue?: string;
  remoteOptions: Record<string, IntegrationChannel[] | undefined>;
  /** TikTok only: what the connected account allows. */
  creatorInfo?: TiktokCreatorInfo;
  onChange: (value: unknown) => void;
}

function ProviderField({
  channelId,
  field,
  value,
  remoteParamValue,
  remoteOptions,
  creatorInfo,
  onChange,
}: ProviderFieldProps) {
  const t = useT();
  const label = (
    <label className={styles.fieldLabel}>
      {field.label}
      {field.required && <span className={styles.fieldRequired}> *</span>}
    </label>
  );

  // A creator who turned duet/stitch/comments off on TikTok must not be able
  // to turn them back on from here — the API would reject it and the audit
  // treats offering it as a violation.
  const lockedByCreator =
    !!field.dynamicDisabled &&
    !!creatorInfo &&
    ((field.dynamicDisabled === "duet" && creatorInfo.duetDisabled) ||
      (field.dynamicDisabled === "stitch" && creatorInfo.stitchDisabled) ||
      (field.dynamicDisabled === "comment" && creatorInfo.commentDisabled));

  if (field.type === "checkbox") {
    return (
      <label className={styles.fieldCheckbox}>
        <input
          type="checkbox"
          checked={lockedByCreator ? false : !!value}
          disabled={lockedByCreator}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          {field.label}
          {field.required && <span className={styles.fieldRequired}> *</span>}
          {lockedByCreator && (
            <span className={styles.fieldHelp}>
              {" "}
              {t("createPost.tiktok.disabledByCreator")}
            </span>
          )}
        </span>
      </label>
    );
  }

  if (field.type === "select") {
    // TikTok privacy: only what `creator_info` allows, and nothing preselected
    // — both are audit requirements, so an unloaded creator info means an empty
    // picker rather than our own default.
    const options =
      field.dynamicOptions === "tiktok-privacy"
        ? (field.options ?? []).filter((opt) =>
            (creatorInfo?.privacyOptions ?? []).includes(opt.value),
          )
        : (field.options ?? []);
    const needsExplicitChoice =
      field.dynamicOptions === "tiktok-privacy" || !field.required;

    return (
      <div className={styles.field}>
        {label}
        <select
          className={styles.fieldSelect}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {needsExplicitChoice && (
            <option value="">
              {field.dynamicOptions === "tiktok-privacy"
                ? t("createPost.select")
                : "-"}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {field.help && <span className={styles.fieldHelp}>{field.help}</span>}
      </div>
    );
  }

  if (field.type === "remote-select") {
    const key = `${channelId}::${field.remoteFn ?? ""}::${remoteParamValue ?? ""}`;
    const options = remoteOptions[key];
    return (
      <div className={styles.field}>
        {label}
        {options === undefined ? (
          <span className={styles.fieldHelp}>
            {t("createPost.loading")}
          </span>
        ) : options.length === 0 ? (
          <span className={styles.fieldHelp}>
            {t("createPost.nothingAvailable")}
          </span>
        ) : (
          <select
            className={styles.fieldSelect}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="" disabled>
              {t("createPost.select")}
            </option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>
        )}
        {field.help && <span className={styles.fieldHelp}>{field.help}</span>}
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className={styles.field}>
        {label}
        <textarea
          className={styles.fieldTextarea}
          value={(value as string) ?? ""}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
        {field.help && <span className={styles.fieldHelp}>{field.help}</span>}
      </div>
    );
  }

  if (field.type === "tags" || field.type === "emails") {
    // Stored as an array; edited as a comma-separated string in the input.
    const asString = Array.isArray(value)
      ? (value as unknown[])
          .map((v) =>
            field.type === "tags" && v && typeof v === "object"
              ? String((v as { label?: string }).label ?? "")
              : String(v),
          )
          .join(", ")
      : "";
    return (
      <div className={styles.field}>
        {label}
        <input
          className={styles.fieldInput}
          type="text"
          value={asString}
          placeholder={field.placeholder ?? t("createPost.commaSeparated")}
          onChange={(e) => {
            const parts = e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (field.type === "tags") {
              onChange(parts.map((p) => ({ value: p, label: p })));
            } else {
              onChange(parts);
            }
          }}
        />
        {field.help && <span className={styles.fieldHelp}>{field.help}</span>}
      </div>
    );
  }

  // text / url
  return (
    <div className={styles.field}>
      {label}
      <input
        className={styles.fieldInput}
        type={field.type === "url" ? "url" : "text"}
        value={(value as string) ?? ""}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.help && <span className={styles.fieldHelp}>{field.help}</span>}
    </div>
  );
}
