import type { WindowParams } from './policy-types';

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timezone: string) => {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f;
};

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const partsOf = (date: Date, timezone: string): Parts => {
  const out: Record<string, string> = {};
  for (const p of formatterFor(timezone).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: DAY_INDEX[out.weekday],
  };
};

/** Local weekday (0 = Sunday) and minutes since local midnight in the zone. */
export const wallClock = (date: Date, timezone: string): { day: number; minutes: number } => {
  const p = partsOf(date, timezone);
  return { day: p.weekday, minutes: p.hour * 60 + p.minute };
};

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const isInsideWindow = (date: Date, w: WindowParams): boolean => {
  const { day, minutes } = wallClock(date, w.timezone);
  const start = toMinutes(w.start);
  const end = toMinutes(w.end);
  if (start < end) {
    return w.days.includes(day) && minutes >= start && minutes < end;
  }
  // Overnight window: the part after midnight belongs to the previous day.
  const previous = (day + 6) % 7;
  return (w.days.includes(day) && minutes >= start) || (w.days.includes(previous) && minutes < end);
};

/** Zone offset in ms (local minus UTC) at the given instant, second precision. */
const offsetAt = (instant: number, timezone: string) => {
  const p = partsOf(new Date(instant), timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
};

const localMidnight = (year: number, month: number, day: number, timezone: string) => {
  const guess = Date.UTC(year, month - 1, day);
  let result = guess - offsetAt(guess, timezone);
  result = guess - offsetAt(result, timezone);
  return result;
};

/** The local day containing `date`: start inclusive, end exclusive. */
export const dayBounds = (date: Date, timezone: string): { start: Date; end: Date } => {
  const p = partsOf(date, timezone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return {
    start: new Date(localMidnight(p.year, p.month, p.day, timezone)),
    end: new Date(
      localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timezone)
    ),
  };
};
