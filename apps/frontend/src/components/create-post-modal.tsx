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
import { DatePicker, TimePicker } from "./date-picker";
import { type Channel } from "@/lib/calendar-data";
import {
  getIntegrationChannels,
  type IntegrationChannel,
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
  /** Delete the post. When provided (edit mode), a "Delete" button is shown. */
  onDelete?: () => void;
  /**
   * When set, the modal opens in edit mode: prefilled with these values and
   * the primary action updates the existing post instead of creating one.
   */
  initialValue?: InitialPostValue;
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

/** Resolve the backend provider identifier for a channel. */
function channelIdentifier(c: Channel): string | undefined {
  return c.identifier ?? identifierFromPlatform(c.platform);
}

/**
 * Turn any thrown error (ApiError, network failure, validation array) into a
 * friendly, human sentence we can show in the modal.
 */
function humanizeSubmitError(err: unknown): string {
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
    const first = String(body.message[0]);
    return capitalizeFirst(first);
  }
  if (body && typeof body.message === "string" && body.message.trim()) {
    return capitalizeFirst(body.message);
  }

  // Network / fetch failure (no response).
  if (
    anyErr?.message?.toLowerCase().includes("failed to fetch") ||
    anyErr?.message?.toLowerCase().includes("networkerror")
  ) {
    return "We couldn't reach the server. Check your connection and try again.";
  }

  if (anyErr?.status === 413) {
    return "One of your attachments is too large. Try a smaller file.";
  }
  if (anyErr?.status === 429) {
    return "You're going a little fast. Wait a moment and try again.";
  }
  if (anyErr?.status === 402) {
    // Plan limit reached (posts per month / no active plan).
    const section =
      body && typeof body === "object" && "section" in body
        ? String((body as { section?: unknown }).section)
        : "";
    if (section === "posts_per_month") {
      return "You've reached your monthly post limit. Upgrade your plan in Billing to keep publishing.";
    }
    return "Your plan doesn't allow this action. Open Billing to upgrade your plan.";
  }
  if (anyErr?.status && anyErr.status >= 500) {
    return "Something went wrong on our side. Please try again in a moment.";
  }

  if (anyErr?.message && anyErr.message.trim()) {
    return capitalizeFirst(anyErr.message);
  }
  return "Something went wrong while saving your post. Please try again.";
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
  onDelete,
  initialValue,
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
  const [media, setMedia] = useState<AttachedMedia[]>([]);

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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Submit lifecycle: which action is in-flight, and any error to surface.
  const [submitting, setSubmitting] = useState<
    null | "draft" | "schedule" | "now"
  >(null);
  // System / backend error (e.g. validation rejected server-side, network).
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set true once the user has attempted to submit, so we reveal the
  // "what's missing" summary even before they fix things.
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

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
        const key = `${c.id}::${field.remoteFn}`;
        if (fetchedKeysRef.current.has(key)) continue;
        fetchedKeysRef.current.add(key);
        void (async () => {
          const list = await getIntegrationChannels(c.id, field.remoteFn);
          if (!cancelled) {
            setRemoteOptions((prev) => ({ ...prev, [key]: list }));
          }
        })();
      }
    }
    return () => {
      cancelled = true;
    };
  }, [selectedChannels, requirementFor]);

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
    setChannelSettings((prev) => ({
      ...prev,
      [integrationId]: { ...(prev[integrationId] ?? {}), [key]: value },
    }));
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
          `Content is too long for ${req.label} (max ${maxLen} characters).`,
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
          problems.push(`${field.label} is required for ${req.label}.`);
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
        list.push("Add some text for this channel.");
      }
      list.push(...(channelProblems[c.id] ?? []));
      if (list.length > 0) out.push({ channel: c, problems: list });
    }
    return out;
  }, [selectedChannels, bodyForChannel, channelProblems]);

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
      kind: "draft" | "schedule" | "now",
      handler?: (post: NewPostInput) => void | Promise<void>,
    ) => {
      if (!handler) return;
      setSubmitError(null);

      // Drafts are allowed to be incomplete; scheduling / publishing aren't.
      if (kind !== "draft") {
        setShowValidation(true);
        if (selectedIds.size === 0) {
          setSubmitError(t("createPost.pickChannel" as any));
          return;
        }
        if (validationSummary.length > 0) {
          // The inline per-channel panels already show the details; nudge the
          // user toward them with a single friendly line.
          setSubmitError(
            t("createPost.attentionNeeded" as any),
          );
          return;
        }
      } else if (selectedIds.size === 0) {
        setSubmitError(t("createPost.pickDraft" as any));
        return;
      }

      setSubmitting(kind);
      try {
        await handler(buildPost());
        // Parent closes the modal on success; nothing else to do here.
      } catch (err) {
        console.error("[submit-post]", err);
        setSubmitError(humanizeSubmitError(err));
        setSubmitting(null);
      }
    },
    [buildPost, selectedIds.size, validationSummary.length],
  );

  // Preview: in global mode, every channel renders the same body. In per-channel,
  // each renders its own override.
  const previewContent = (channelId: string): string => {
    if (mode === "global") return bodies[GLOBAL_KEY] ?? "";
    return bodies[channelId] ?? "";
  };

  const placeholder =
    mode === "global"
      ? "Write something — same content for every selected channel"
      : `Write something for ${
          channels.find((c) => c.id === activeTarget)?.name ?? "this channel"
        }`;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Create post"
      onClick={onClose}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <span className={styles.title}>
            {isEdit ? t("createPost.editTitle" as any) : t("createPost.title" as any)}
          </span>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.editor}>
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
                  <span>Almost there — a few things to finish:</span>
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
                  Global write
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
                  Per channel
                </button>
              </div>

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
              value={currentBody}
              onChange={(e) => setCurrentBody(e.target.value)}
              placeholder={placeholder}
              className={styles.textarea}
              rows={8}
            />

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
                bodyLength={bodyForChannel(c.id).length}
                onChange={(key, value) => setChannelSetting(c.id, key, value)}
              />
            ))}

            {media.length > 0 && (
              <div className={styles.mediaList}>
                {media.map((m) => (
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
                Add image
              </button>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={onPickMedia}
              >
                <VideoIcon />
                Add video
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
                Add comment / post
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
                      placeholder="Reply, comment or follow-up post"
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
            <span className={styles.previewLabel}>Post preview</span>
            {selectedChannels.length === 0 ? (
              <span className={styles.previewEmpty}>
                Select at least one channel.
              </span>
            ) : (
              (() => {
                const previewChannel =
                  mode === "per-channel"
                    ? selectedChannels.find((c) => c.id === activeTarget) ??
                      selectedChannels[0]
                    : selectedChannels[0];
                const text = previewContent(previewChannel.id);
                const isEmpty = text.trim().length === 0;
                const visibleThread = threadParts.filter(
                  (p) => p.trim().length > 0,
                );
                return (
                  <article className={styles.previewCard}>
                    <header className={styles.previewCardHead}>
                      <ChannelAvatar
                        channel={previewChannel}
                        size={30}
                        circular
                        showPlatformBadge
                      />
                      <div className={styles.previewIdentity}>
                        <span className={styles.previewName}>
                          {previewChannel.name}
                        </span>
                        <span className={styles.previewPlatform}>
                          {previewChannel.platform}
                          {selectedChannels.length > 1 &&
                            ` · 1 of ${selectedChannels.length}`}
                        </span>
                      </div>
                    </header>
                    {isEmpty ? (
                      <p className={styles.previewEmptyBody}>
                        {mode === "per-channel"
                          ? "No content yet for this channel"
                          : "Start writing for a preview"}
                      </p>
                    ) : (
                      <p className={styles.previewBody}>{text}</p>
                    )}
                    {media.length > 0 && (
                      <div className={styles.previewMedia}>
                        {media.slice(0, 3).map((m) => (
                          <span key={m.id} className={styles.previewMediaItem}>
                            {m.kind === "image" ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.url} alt="" />
                            ) : (
                              <video src={m.url} muted playsInline />
                            )}
                          </span>
                        ))}
                        {media.length > 3 && (
                          <span className={styles.previewMediaMore}>
                            +{media.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    {visibleThread.length > 0 && (
                      <div className={styles.previewThread}>
                        {visibleThread.map((p, i) => (
                          <p key={i} className={styles.previewThreadItem}>
                            ↳ {p}
                          </p>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })()
            )}
          </aside>
        </div>

        <footer className={styles.foot}>
          <div className={styles.footLeft}>
            <DatePicker value={postDate} onChange={setPostDate} />
            <TimePicker value={postTime} onChange={setPostTime} />
          </div>
          <div className={styles.footRight}>
            {isEdit && onDelete && (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={submitting !== null}
                onClick={onDelete}
              >
                {t("common.delete" as any)}
              </button>
            )}
            {!isEdit && (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={submitting !== null}
                onClick={() => runSubmit("draft", onSaveDraft)}
              >
                {submitting === "draft" ? "Saving…" : t("createPost.saveDraft" as any)}
              </button>
            )}
            {onPublishNow && (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={submitting !== null}
                onClick={() => runSubmit("now", onPublishNow)}
              >
                {submitting === "now" ? "Publishing…" : t("createPost.publishNow" as any)}
              </button>
            )}
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={submitting !== null}
              onClick={() => runSubmit("schedule", onSchedule)}
            >
              {submitting === "schedule"
                ? "Saving…"
                : isEdit
                  ? t("createPost.update" as any)
                  : t("createPost.schedule" as any)}
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
  bodyLength,
  onChange,
}: ProviderSettingsPanelProps) {
  const visibleFields = requirement.fields.filter(
    (f) => !f.showIf || f.showIf(settings),
  );

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

      {visibleFields.length > 0 && (
        <div className={styles.providerFields}>
          {visibleFields.map((field) => (
            <ProviderField
              key={field.key}
              channelId={channel.id}
              field={field}
              value={settings[field.key]}
              remoteOptions={remoteOptions}
              onChange={(value) => onChange(field.key, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ProviderFieldProps {
  channelId: string;
  field: SettingsField;
  value: unknown;
  remoteOptions: Record<string, IntegrationChannel[] | undefined>;
  onChange: (value: unknown) => void;
}

function ProviderField({
  channelId,
  field,
  value,
  remoteOptions,
  onChange,
}: ProviderFieldProps) {
  const label = (
    <label className={styles.fieldLabel}>
      {field.label}
      {field.required && <span className={styles.fieldRequired}> *</span>}
    </label>
  );

  if (field.type === "checkbox") {
    return (
      <label className={styles.fieldCheckbox}>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          {field.label}
          {field.required && <span className={styles.fieldRequired}> *</span>}
        </span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <div className={styles.field}>
        {label}
        <select
          className={styles.fieldSelect}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {!field.required && <option value="">—</option>}
          {field.options?.map((opt) => (
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
    const key = `${channelId}::${field.remoteFn ?? ""}`;
    const options = remoteOptions[key];
    return (
      <div className={styles.field}>
        {label}
        {options === undefined ? (
          <span className={styles.fieldHelp}>Loading…</span>
        ) : options.length === 0 ? (
          <span className={styles.fieldHelp}>
            Nothing available yet. Make sure the account has access.
          </span>
        ) : (
          <select
            className={styles.fieldSelect}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="" disabled>
              Select…
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
          placeholder={field.placeholder ?? "Comma-separated"}
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
