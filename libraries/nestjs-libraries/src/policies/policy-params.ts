import type { PolicyConditionName } from './policy-types';

export type ParamResult =
  | { ok: true; value: unknown }
  | { ok: false; field: string; message: string };

const fail = (field: string, message: string): ParamResult => ({ ok: false, field, message });

export const isValidTimezone = (tz: string): boolean => {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const unknownKey = (obj: Record<string, unknown>, allowed: string[]) =>
  Object.keys(obj).find((k) => !allowed.includes(k));

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export const validateConditionParams = (
  condition: PolicyConditionName,
  params: unknown
): ParamResult => {
  const obj: Record<string, unknown> = params === undefined || params === null ? {} : (params as never);
  if (!isRecord(obj)) return fail('conditionParams', 'conditionParams must be an object');

  const allowedKeys: Record<PolicyConditionName, string[]> = {
    ALWAYS: [],
    CONTAINS_LINK: [],
    PUBLISH_NOW: [],
    HAS_VIDEO: [],
    CONTAINS_WORDS: ['words'],
    OUTSIDE_WINDOW: ['days', 'start', 'end', 'timezone'],
    DAILY_CAP_EXCEEDED: ['max', 'scope', 'timezone'],
  };
  const extra = unknownKey(obj, allowedKeys[condition]);
  if (extra !== undefined) return fail(extra, `Unknown parameter "${extra}" for ${condition}`);

  switch (condition) {
    case 'CONTAINS_WORDS': {
      const { words } = obj;
      if (!Array.isArray(words) || words.length < 1 || words.length > 100) {
        return fail('words', 'words must be a list of 1 to 100 entries');
      }
      const seen = new Set<string>();
      const clean: string[] = [];
      for (const w of words) {
        if (typeof w !== 'string') return fail('words', 'every word must be a string');
        const t = w.trim();
        if (t.length < 1 || t.length > 100) {
          return fail('words', 'every word must be 1 to 100 characters');
        }
        const key = t.toLowerCase();
        if (seen.has(key)) return fail('words', `Duplicate word "${t}"`);
        seen.add(key);
        clean.push(t);
      }
      return { ok: true, value: { words: clean } };
    }
    case 'OUTSIDE_WINDOW': {
      const { days, start, end, timezone } = obj;
      if (
        !Array.isArray(days) ||
        days.length < 1 ||
        days.length > 7 ||
        days.some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6) ||
        new Set(days).size !== days.length
      ) {
        return fail('days', 'days must be unique integers from 0 (Sunday) to 6 (Saturday)');
      }
      if (typeof start !== 'string' || !TIME.test(start)) {
        return fail('start', 'start must be HH:mm (00:00 to 23:59)');
      }
      if (typeof end !== 'string' || !TIME.test(end)) {
        return fail('end', 'end must be HH:mm (00:00 to 23:59)');
      }
      if (minutesOf(start) === minutesOf(end)) return fail('end', 'end must differ from start');
      if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
        return fail('timezone', 'timezone must be a valid IANA timezone');
      }
      return { ok: true, value: { days: [...(days as number[])], start, end, timezone } };
    }
    case 'DAILY_CAP_EXCEEDED': {
      const { max, scope, timezone } = obj;
      if (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 10000) {
        return fail('max', 'max must be an integer from 1 to 10000');
      }
      if (scope !== 'organization' && scope !== 'channel') {
        return fail('scope', 'scope must be "organization" or "channel"');
      }
      if (timezone !== undefined && (typeof timezone !== 'string' || !isValidTimezone(timezone))) {
        return fail('timezone', 'timezone must be a valid IANA timezone');
      }
      return { ok: true, value: { max, scope, timezone: (timezone as string | undefined) ?? 'UTC' } };
    }
    default:
      return { ok: true, value: {} };
  }
};
