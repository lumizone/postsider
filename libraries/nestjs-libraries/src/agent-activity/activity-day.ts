// Local day bounds in an IANA time zone, correct on DST days (23 or 25 hours).

/** Canonical IANA name of a zone (fixes casing), or null for anything else. */
export function canonicalTimeZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 100) return null;
  // offset zones (+05:30) are not IANA names: not accepted
  if (/^[+-]/.test(tz)) return null;
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
    return typeof name === 'string' && name.length > 0 && !/^[+-]/.test(name) ? name : null;
  } catch {
    return null;
  }
}

export function isValidTimeZone(tz: unknown): tz is string {
  return canonicalTimeZone(tz) !== null;
}

export function resolveTimeZone(
  requested?: string | null,
  orgDefault?: string | null
): string {
  return canonicalTimeZone(requested) ?? canonicalTimeZone(orgDefault) ?? 'UTC';
}

const MAX_FORMATTERS = 200;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    if (formatters.size >= MAX_FORMATTERS) formatters.clear();
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

export function formatterCacheSize(): number {
  return formatters.size;
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
