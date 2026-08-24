"use client";

import { useEffect, useMemo } from "react";
import styles from "./day-popup.module.css";
import { PlatformIcon } from "./platform-icon";
import { type CalendarEvent, type Channel } from "@/lib/calendar-data";
import { useT } from "@/lib/i18n";
import { layoutOverlappingEvents } from "@/lib/event-lanes";

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

  const today = new Date();
  const showNowLine = isSameDay(date, today);
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;

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
            style={{ height: HOUR_HEIGHT * HOURS.length }}
          >
            {HOURS.map((h) => (
              <div
                key={h}
                className={styles.hourRow}
                style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
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

            {(() => {
              // Overlapping events are laid out side by side instead of
              // stacking on top of each other.
              const placements = layoutOverlappingEvents(
                sortedEvents.map((ev) => ({
                  id: ev.id,
                  startMin: timeToMinutes(ev.time),
                  endMin:
                    timeToMinutes(ev.time) +
                    (ev.durationMinutes ?? DEFAULT_DURATION),
                })),
              );
              return sortedEvents.map((ev) => {
                const { top, height } = eventTopAndHeight(
                  ev.time,
                  ev.durationMinutes ?? DEFAULT_DURATION,
                );
                const c = channelsById.get(ev.channelId);
                const placement = placements.get(ev.id);
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
                            left: `calc(${placement.leftPct}% + 64px)`,
                            width: `calc(${placement.widthPct}% - 72px)`,
                          }
                        : {}),
                    }}
                    onClick={() => onEditEvent?.(ev)}
                  >
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
                  </button>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
