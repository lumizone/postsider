"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./date-picker.module.css";
import { useT } from "@/lib/i18n";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/* -------------------------------------------------------------------------- */
/*                              Date Picker                                    */
/* -------------------------------------------------------------------------- */

interface DatePickerProps {
  /** YYYY-MM-DD */
  value: string;
  onChange: (value: string) => void;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => {
    if (!value) return new Date();
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [value]);

  const [viewYear, setViewYear] = useState(parsed.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.getMonth());

  // Sync view when value changes externally.
  useEffect(() => {
    setViewYear(parsed.getFullYear());
    setViewMonth(parsed.getMonth());
  }, [parsed]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const prev = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const next = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const today = new Date();

  const cells = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // Mon-first
    const gridStart = new Date(viewYear, viewMonth, 1 - leadingBlanks);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }
    return days;
  }, [viewYear, viewMonth]);

  const pick = (d: Date) => {
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    onChange(iso);
    setOpen(false);
  };

  const display = value
    ? `${pad(parsed.getDate())} ${MONTHS[parsed.getMonth()].slice(0, 3)} ${parsed.getFullYear()}`
    : t("common.pickDate");

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarSvg />
        <span>{display}</span>
      </button>

      {open && (
        <div className={styles.dropdown} role="dialog" aria-label={t("common.pickDate")}>
          <div className={styles.header}>
            <button type="button" className={styles.navBtn} onClick={prev} aria-label={t("calendar.prevMonth")}>
              <ChevLeft />
            </button>
            <span className={styles.headerLabel}>
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" className={styles.navBtn} onClick={next} aria-label={t("calendar.nextMonth")}>
              <ChevRight />
            </button>
          </div>

          <div className={styles.weekdays}>
            {WEEKDAYS.map((d) => (
              <span key={d} className={styles.weekday}>{d}</span>
            ))}
          </div>

          <div className={styles.grid}>
            {cells.map((d, i) => {
              const inMonth = d.getMonth() === viewMonth;
              const isToday = isSameDay(d, today);
              const isSelected = isSameDay(d, parsed);
              return (
                <button
                  key={i}
                  type="button"
                  className={
                    styles.day +
                    (!inMonth ? " " + styles.dayMuted : "") +
                    (isToday ? " " + styles.dayToday : "") +
                    (isSelected ? " " + styles.daySelected : "")
                  }
                  onClick={() => pick(d)}
                  tabIndex={inMonth ? 0 : -1}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.footerBtn}
              onClick={() => pick(today)}
            >
              {t("calendar.today")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Time Picker                                     */
/* -------------------------------------------------------------------------- */

interface TimePickerProps {
  /** HH:mm */
  value: string;
  onChange: (value: string) => void;
}

export function TimePicker({ value, onChange }: TimePickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const [hours, minutes] = useMemo(() => {
    const [h, m] = (value || "09:00").split(":").map(Number);
    return [h, m];
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);

  // Scroll to current values when opening.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const hEl = hoursRef.current?.children[hours] as HTMLElement | undefined;
      hEl?.scrollIntoView({ block: "center", behavior: "instant" });
      const mEl = minutesRef.current?.children[minutes] as HTMLElement | undefined;
      mEl?.scrollIntoView({ block: "center", behavior: "instant" });
    });
  }, [open, hours, minutes]);

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <ClockSvg />
        <span>{pad(hours)}:{pad(minutes)}</span>
      </button>

      {open && (
        <div className={styles.timeDropdown} role="dialog" aria-label={t("common.pickTime")}>
          <div className={styles.timeColumns}>
            <div className={styles.timeColumn} ref={hoursRef}>
              {Array.from({ length: 24 }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={
                    styles.timeCell +
                    (i === hours ? " " + styles.timeCellActive : "")
                  }
                  onClick={() => {
                    onChange(`${pad(i)}:${pad(minutes)}`);
                  }}
                >
                  {pad(i)}
                </button>
              ))}
            </div>
            <div className={styles.timeSeparator}>:</div>
            <div className={styles.timeColumn} ref={minutesRef}>
              {Array.from({ length: 60 }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={
                    styles.timeCell +
                    (i === minutes ? " " + styles.timeCellActive : "")
                  }
                  onClick={() => {
                    onChange(`${pad(hours)}:${pad(i)}`);
                  }}
                >
                  {pad(i)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   SVGs                                       */
/* -------------------------------------------------------------------------- */

function CalendarSvg() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <rect x="2.75" y="3.75" width="10.5" height="9.5" rx="1.75" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.75 6.5h10.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 2.5v2M11 2.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ClockSvg() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevLeft() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="12" height="12">
      <path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevRight() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="12" height="12">
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
