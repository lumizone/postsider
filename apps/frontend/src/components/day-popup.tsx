"use client";

import { useEffect, useMemo } from "react";
import styles from "./day-popup.module.css";
import { PlatformIcon } from "./platform-icon";
import { PostMediaThumb } from "./post-media-thumb";
import { type CalendarEvent, type Channel } from "@/lib/calendar-data";
import { useT } from "@/lib/i18n";
import {
  buildStackLayout,
  layoutOverlappingEvents,
  offsetAtMinute,
  offsetBeforeHour,
} from "@/lib/event-lanes";
import { PHONE_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { MIN_CARD_WIDTH, useElementWidth } from "@/lib/use-element-width";

interface DayPopupProps {
  date: Date;
  events: CalendarEvent[];
  channelsById: Map<string, Channel>;
  onClose: () => void;
  onCreate: (date: Date, time: string) => void;
  onEditEvent?: (ev: CalendarEvent) => void;
}

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DEFAULT_DURATION = 45;

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
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function eventTopAndHeight(time: string, durationMinutes: number) {
  const [h, m] = time.split(":").map(Number);
  const minutes = h * 60 + m;
  const top = (minutes / 60) * HOUR_HEIGHT;
  const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT, 28);
  return { top, height };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatHourLabel(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

function formatHeaderDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function channelInitial(c: Channel) {
  return (c.name.trim()[0] ?? "?").toUpperCase();
}

void channelInitial;

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function DayPopup({
  date,
  events,
  channelsById,
  onClose,
  onCreate,
  onEditEvent,
}: DayPopupProps) {
  const t = useT();
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

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => a.time.localeCompare(b.time)),
    [events],
  );

  // Phones always stack (full-width cards, one under another, the hour block
  // grows). Wider modals keep lanes, but only as many as fit a readable card:
  // the layer is measured, so four posts in one hour stack instead of turning
  // into 22px slivers.
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [layerRef, layerWidth] = useElementWidth<HTMLDivElement>();
  const maxLanes = isPhone
    ? 1
    : layerWidth
      ? Math.max(1, Math.floor(layerWidth / MIN_CARD_WIDTH))
      : 2;

  const positioned = useMemo(
    () =>
      sortedEvents.map((ev) => ({
        id: ev.id,
        startMin: timeToMinutes(ev.time),
        endMin: timeToMinutes(ev.time) + (ev.durationMinutes ?? DEFAULT_DURATION),
      })),
    [sortedEvents],
  );

  const stack = useMemo(
    () =>
      buildStackLayout(
        positioned,
        HOUR_HEIGHT,
        28,
        undefined,
        (count) => count > maxLanes,
      ),
    [positioned, maxLanes],
  );
  // Lanes come from the posts that did not stack, so a stacked hour cannot
  // inflate the lane count of the rest of the day.
  const lanes = useMemo(
    () =>
      layoutOverlappingEvents(
        positioned.filter((ev) => !stack.placements.get(ev.id)?.stacked),
      ),
    [positioned, stack],
  );

  const extraByHour = stack.extraByHour;
  const timelineHeight = HOUR_HEIGHT * HOURS.length + stack.totalExtra;

  const today = new Date();
  const showNowLine = isSameDay(date, today);
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const nowTop =
    (nowMinutes / 60) * HOUR_HEIGHT + offsetAtMinute(extraByHour, nowMinutes);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t("calendar.scheduleFor", { date: formatHeaderDate(date) })}
      onClick={onClose}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div className={styles.headLeft}>
            <span className={styles.eyebrow}>
              {date.toLocaleDateString("en-US", { weekday: "long" })}
            </span>
            <span className={styles.title}>
              {date.toLocaleDateString("en-US", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <span className={styles.subtitle}>
              {sortedEvents.length === 0
                ? t("calendar.noPostsScheduled")
                : t("calendar.postsScheduled", { count: sortedEvents.length })}
            </span>
          </div>
          <div className={styles.headRight}>
            <button
              type="button"
              className={styles.newBtn}
              onClick={() => onCreate(date, "09:00")}
            >
              + {t("posts.newPost")}
            </button>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label={t("common.close")}
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className={styles.body}>
          <div
            className={styles.timeline}
            style={{ height: timelineHeight }}
          >
            {HOURS.map((h) => (
              <div
                key={h}
                className={styles.hourRow}
                style={{
                  top: h * HOUR_HEIGHT + offsetBeforeHour(extraByHour, h),
                  height: HOUR_HEIGHT + (extraByHour[h] ?? 0),
                }}
              >
                <span className={styles.hourLabel}>
                  {h === 0 ? "" : formatHourLabel(h)}
                </span>
                <button
                  type="button"
                  className={styles.hourSlot}
                  onClick={() =>
                    onCreate(date, `${String(h).padStart(2, "0")}:00`)
                  }
                  aria-label={t("calendar.addPostAt", { time: formatHourLabel(h) })}
                >
                  <span className={styles.plusBubble} aria-hidden>
                    <PlusIcon />
                  </span>
                </button>
              </div>
            ))}

            {showNowLine && (
              <div
                className={styles.nowLine}
                style={{ top: nowTop }}
                aria-hidden
              />
            )}

            {/* Events live in their own layer, inset past the hour labels, so
                lane percentages are of the card area — the old
                `calc(50% - 72px)` on the full width went NEGATIVE at four
                lanes and the cards vanished. */}
            <div className={styles.eventLayer} ref={layerRef}>
              {sortedEvents.map((ev) => {
                const natural = eventTopAndHeight(
                  ev.time,
                  ev.durationMinutes ?? DEFAULT_DURATION,
                );
                const slot = stack.placements.get(ev.id);
                const top = slot ? slot.top : natural.top;
                const height = slot ? slot.height : natural.height;
                const c = channelsById.get(ev.channelId);
                const placement = slot?.stacked ? undefined : lanes.get(ev.id);
                return (
                  <button
                    type="button"
                    key={ev.id}
                    className={styles.event}
                    style={{
                      top,
                      height,
                      borderLeft: c
                        ? `3px solid ${c.color}`
                        : "3px solid var(--fg)",
                      ...(placement
                        ? {
                            left: `${placement.leftPct}%`,
                            width: `calc(${placement.widthPct}% - 6px)`,
                          }
                        : {}),
                    }}
                    onClick={() => onEditEvent?.(ev)}
                  >
                    {/* Renders nothing when the post has no media. */}
                    <PostMediaThumb media={ev.media} size={24} />
                    <div className={styles.eventBody}>
                      <div className={styles.eventHead}>
                        {c ? (
                          <PlatformIcon platform={c.platform} size={18} />
                        ) : (
                          <span className={styles.eventBadge} aria-hidden>?</span>
                        )}
                        <span className={styles.eventTitle}>{ev.title}</span>
                      </div>
                      <span className={styles.eventMeta}>
                        {ev.time}
                        {c ? ` · ${c.name}` : ""}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
