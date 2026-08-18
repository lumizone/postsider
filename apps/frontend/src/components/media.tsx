"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./media.module.css";
import { ChannelAvatar } from "./channel-avatar";
import { EmptyState } from "./empty-state";
import { useT } from "@/lib/i18n";
import { ConfirmDialog } from "./confirm-dialog";
import { type MediaItem, type MediaKind } from "@/lib/media-data";
import { type Channel } from "@/lib/calendar-data";
import { useChannels } from "@/lib/use-channels";
import {
  backendMediaToItem,
  backendMediaToUrl,
  deleteMediaItem,
  fetchMedia,
  uploadMedia,
  type BackendMedia,
} from "@/lib/media-api";

type Filter = "all" | MediaKind;
type View = "list" | "grid";

const FILTER_LABELS: Record<Filter, string> = {
  all: "all",
  image: "images",
  video: "videos",
};

function formatBytes(b: number): string {
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(1) + " GB";
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden width="14" height="14">
      <rect
        x="2.75"
        y="3.75"
        width="14.5"
        height="12.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="7" cy="8" r="1.3" fill="currentColor" />
      <path
        d="M3.5 14 8 10.5l3.5 3 3-2 2 2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden width="14" height="14">
      <rect
        x="2.75"
        y="4.75"
        width="14.5"
        height="10.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M8.5 7.8 13 10l-4.5 2.2V7.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 4.5h9M3.5 8h9M3.5 11.5h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3" y="3" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.5" y="3" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="3" y="8.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.5" y="8.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function Media() {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("grid");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [raw, setRaw] = useState<BackendMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Non-blocking error banner for actions (e.g. failed delete), shown above
  // the grid without replacing it.
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { channels } = useChannels();

  const channelsById = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of channels) m.set(c.id, c);
    return m;
  }, [channels]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch a few pages so the gallery feels populated. The backend caps
      // each page at 18.
      const collected: BackendMedia[] = [];
      for (let page = 1; page <= 6; page++) {
        const res = await fetchMedia(page);
        collected.push(...res.results);
        if (page >= (res.pages ?? 1)) break;
      }
      setRaw(collected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load media");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const items = useMemo(() => {
    const mapped: { item: MediaItem; src: string; backend: BackendMedia }[] =
      raw.map((m) => ({
        item: backendMediaToItem(m),
        src: backendMediaToUrl(m),
        backend: m,
      }));
    const sorted = [...mapped].sort(
      (a, b) =>
        new Date(b.item.uploadedAt).getTime() -
        new Date(a.item.uploadedAt).getTime(),
    );
    if (filter === "all") return sorted;
    return sorted.filter((m) => m.item.kind === filter);
  }, [raw, filter]);

  const counts = useMemo(() => {
    const total = raw.length;
    const images = raw.filter((m) => m.type !== "video").length;
    const videos = raw.filter((m) => m.type === "video").length;
    return { total, images, videos };
  }, [raw]);

  const previewEntry = useMemo(
    () => items.find((m) => m.item.id === previewId) ?? null,
    [items, previewId],
  );

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadMedia(file);
      }
      await refresh();
    } catch (err) {
      console.error("[upload-media]", err);
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const onDelete = async (id: string) => {
    setDeleteBusy(true);
    const snapshot = raw;
    setRaw((prev) => prev.filter((m) => m.id !== id));
    try {
      await deleteMediaItem(id);
      setDeleteId(null);
    } catch (err) {
      console.error("[delete-media]", err);
      setRaw(snapshot);
      setActionError(t("errors.mediaDelete"));
      setDeleteId(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  // Close preview on Escape, and lock background scroll while open.
  useEffect(() => {
    if (!previewEntry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewId(null);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [previewEntry]);

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.eyebrow}>{t("media.eyebrow")}</span>
          <h1 className={styles.h1}>{t("media.title")}</h1>
          <p className={styles.subtitle}>
            {t("media.subtitle")}
            {" "}
            {t("media.counts", {
              images: counts.images,
              videos: counts.videos,
              total: counts.total,
            })}
          </p>
        </div>

        <div className={styles.headerControls}>
          <div className={styles.segmented} role="tablist" aria-label={t("media.type")}>
            {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={
                  styles.segment +
                  (filter === f ? " " + styles.segmentActive : "")
                }
                onClick={() => setFilter(f)}
              >
                {t(`media.${FILTER_LABELS[f]}` as any)}
              </button>
            ))}
          </div>

          <div className={styles.viewToggle} role="tablist" aria-label={t("media.viewMode")}>
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              aria-label={t("media.list")}
              className={
                styles.viewBtn + (view === "list" ? " " + styles.viewBtnActive : "")
              }
              onClick={() => setView("list")}
            >
              <ListIcon />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "grid"}
              aria-label={t("media.grid")}
              className={
                styles.viewBtn + (view === "grid" ? " " + styles.viewBtnActive : "")
              }
              onClick={() => setView("grid")}
            >
              <GridIcon />
            </button>
          </div>

          <button
            type="button"
            className={styles.uploadBtn}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? t("media.uploading") : t("media.upload")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={onFiles}
            style={{ display: "none" }}
          />
        </div>
      </header>

      {actionError && (
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
          }}
        >
          <span style={{ flex: 1 }}>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
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

      {loading ? (
        <div className={styles.empty}>{t("common.loading")}</div>
      ) : error ? (
        <div className={styles.empty}>{error}</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="media"
          title={t("media.empty")}
          description={t("media.emptyDesc")}
          actionLabel="Open calendar"
          actionHref="/calendar"
        />
      ) : view === "list" ? (
        <div className={styles.list} role="list">
          <div className={styles.listHead} aria-hidden>
            <span>{t("media.name")}</span>
            <span>{t("media.type")}</span>
            <span>{t("media.channel")}</span>
            <span>{t("media.size")}</span>
            <span>{t("media.uploaded")}</span>
          </div>
          {items.map(({ item, src }) => (
            <MediaRow
              key={item.id}
              item={item}
              src={src}
              channel={
                item.channelId ? channelsById.get(item.channelId) : undefined
              }
              onOpen={() => setPreviewId(item.id)}
              onDelete={() => setDeleteId(item.id)}
            />
          ))}
        </div>
      ) : (
        <div className={styles.grid} role="list">
          {items.map(({ item, src }) => (
            <MediaTile
              key={item.id}
              item={item}
              src={src}
              channel={
                item.channelId ? channelsById.get(item.channelId) : undefined
              }
              onOpen={() => setPreviewId(item.id)}
            />
          ))}
        </div>
      )}

      {previewEntry && (
        <MediaPreview
          item={previewEntry.item}
          src={previewEntry.src}
          channel={
            previewEntry.item.channelId
              ? channelsById.get(previewEntry.item.channelId)
              : undefined
          }
          onClose={() => setPreviewId(null)}
          onDelete={() => {
            setDeleteId(previewEntry.item.id);
            setPreviewId(null);
          }}
        />
      )}

      {deleteId && (
        <ConfirmDialog
          danger
          busy={deleteBusy}
          title={t("media.deleteConfirmTitle")}
          body={t("media.deleteConfirmBody")}
          confirmLabel={t("media.deleteBtn")}
          onConfirm={() => void onDelete(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </section>
  );
}

interface MediaRowProps {
  item: MediaItem;
  src: string;
  channel?: Channel;
  onOpen: () => void;
  onDelete: () => void;
}

function MediaRow({ item, src, channel, onOpen, onDelete }: MediaRowProps) {
  const t = useT();
  return (
    <div
      className={styles.row}
      role="listitem"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className={styles.nameCell}>
        <span className={styles.thumb} aria-hidden>
          {item.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 }}
            />
          ) : (
            <VideoIcon />
          )}
        </span>
        <div className={styles.nameMain}>
          <span className={styles.name}>{item.name}</span>
          <span className={styles.dims}>
            {item.width && item.height
              ? `${item.width} × ${item.height}`
              : "-"}
            {item.durationSeconds !== undefined &&
              ` · ${formatDuration(item.durationSeconds)}`}
          </span>
        </div>
      </div>

      <div className={styles.typeCell}>
        <span className={styles.typeChip}>
          {item.kind === "image" ? t("media.image") : t("media.video")}
        </span>
      </div>

      <div className={styles.channelCell}>
        {channel ? (
          <>
            <ChannelAvatar channel={channel} size={24} radius={6} />
            <span className={styles.channelMain}>
              <span className={styles.channelName}>{channel.name}</span>
              <span className={styles.channelPlatform}>{channel.platform}</span>
            </span>
          </>
        ) : (
          <span className={styles.muted}>{t("media.unassigned")}</span>
        )}
      </div>

      <div className={styles.sizeCell}>{formatBytes(item.size)}</div>
      <div className={styles.dateCell}>
        {formatDate(item.uploadedAt)}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={t("media.deleteMedia")}
          style={{
            marginLeft: 12,
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {t("common.delete")}
        </button>
      </div>
    </div>
  );
}

interface MediaTileProps {
  item: MediaItem;
  src: string;
  channel?: Channel;
  onOpen: () => void;
}

function MediaTile({ item, src, channel, onOpen }: MediaTileProps) {
  const t = useT();
  return (
    <button
      type="button"
      className={styles.tile}
      role="listitem"
      title={item.name}
      onClick={onOpen}
    >
      <div className={styles.thumbBox}>
        <span className={styles.thumbBadge}>
          {item.kind === "image" ? t("media.image") : t("media.video")}
        </span>
        {item.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <video
            src={src}
            muted
            playsInline
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}
        <span className={styles.thumbIcon} aria-hidden>
          {item.kind === "image" ? <ImageIcon /> : <VideoIcon />}
        </span>
        {item.durationSeconds !== undefined && (
          <span className={styles.thumbDuration}>
            {formatDuration(item.durationSeconds)}
          </span>
        )}
      </div>

      <div className={styles.tileMeta}>
        <span className={styles.tileName}>{item.name}</span>
        <span className={styles.tileFoot}>
          {item.width && item.height
            ? `${item.width} × ${item.height}`
            : "-"}
          <span className={styles.tileSep}>·</span>
          {formatBytes(item.size)}
        </span>
        <span className={styles.tileFoot}>
          {channel ? (
            <span className={styles.tileChannel}>
              <ChannelAvatar channel={channel} size={16} radius={5} />
              {channel.name} · {channel.platform}
            </span>
          ) : (
            <span>{t("media.unassigned")}</span>
          )}
          <span className={styles.tileSep}>·</span>
          {formatDate(item.uploadedAt)}
        </span>
      </div>
    </button>
  );
}
interface MediaPreviewProps {
  item: MediaItem;
  src: string;
  channel?: Channel;
  onClose: () => void;
  onDelete: () => void;
}

function MediaPreview({ item, src, channel, onClose, onDelete }: MediaPreviewProps) {
  const t = useT();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previouslyFocusedRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${item.name}`}
      onClick={onClose}
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <div className={styles.modalPreview}>
          {item.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={item.name} />
          ) : (
            <video
              src={src}
              controls
              autoPlay
              muted
              playsInline
            />
          )}
          {item.durationSeconds !== undefined && (
            <span className={styles.modalDuration}>
              {formatDuration(item.durationSeconds)}
            </span>
          )}
        </div>

        <div className={styles.modalSide}>
          <div className={styles.modalHead}>
            <div className={styles.modalTitle}>
              <span className={styles.modalKind}>
                {item.kind === "image" ? t("media.image") : t("media.video")}
              </span>
              <span className={styles.modalName}>{item.name}</span>
            </div>
            <button
              type="button"
              className={styles.modalClose}
              ref={closeButtonRef}
              onClick={onClose}
              aria-label={t("common.close")}
            >
              <CloseIcon />
            </button>
          </div>

          <dl className={styles.modalMeta}>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>{t("media.type")}</dt>
              <dd className={styles.metaValue}>
                {item.kind === "image" ? t("media.image") : t("media.video")}
              </dd>
            </div>
            {item.width && item.height && (
              <div className={styles.metaRow}>
                <dt className={styles.metaLabel}>{t("media.dimensions")}</dt>
                <dd className={styles.metaValue}>
                  {item.width} × {item.height}
                </dd>
              </div>
            )}
            {item.durationSeconds !== undefined && (
              <div className={styles.metaRow}>
                <dt className={styles.metaLabel}>{t("media.duration")}</dt>
                <dd className={styles.metaValue}>
                  {formatDuration(item.durationSeconds)}
                </dd>
              </div>
            )}
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>{t("media.size")}</dt>
              <dd className={styles.metaValue}>{formatBytes(item.size)}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>{t("media.uploaded")}</dt>
              <dd className={styles.metaValue}>{formatDate(item.uploadedAt)}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>{t("media.channel")}</dt>
              <dd className={styles.metaValue}>
                {channel ? (
                  <span className={styles.metaChannelValue}>
                    <ChannelAvatar channel={channel} size={16} radius={5} />
                    {channel.name} · {channel.platform}
                  </span>
                ) : (
                  t("media.unassigned")
                )}
              </dd>
            </div>
          </dl>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.modalBtnPrimary}
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.open(src, "_blank", "noopener,noreferrer");
                }
              }}
            >
              {t("media.download")}
            </button>
            <button
              type="button"
              className={styles.modalBtnSecondary}
              onClick={onDelete}
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
