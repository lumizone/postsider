// Local day bounds in an IANA time zone, correct on DST days (23 or 25 hours).

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(
  requested?: string | null,
  orgDefault?: string | null
): string {
  if (isValidTimeZone(requested)) return requested;
  if (isValidTimeZone(orgDefault)) return orgDefault;
  return 'UTC';
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function localParts(instant: number, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

/** Offset of the zone from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // drop sub-second part of the instant so the comparison is exact
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** UTC instant of local midnight on the given local calendar date. */
function localMidnight(year: number, month: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return second;
}

export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const p = localParts(now.getTime(), timeZone);
  const start = localMidnight(p.year, p.month, p.day, timeZone);
  // next local calendar date (Date.UTC normalises day overflow)
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = localMidnight(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone
  );
  return { start: new Date(start), end: new Date(end) };
}
