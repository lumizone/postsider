// Pure helpers for the calendar deep link (`/calendar?post=<id>&date=YYYY-MM-DD`).
// No React, no browser globals.

const POST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** Valid values only; anything else is omitted. */
export function parseCalendarDeepLink(search: string): { postId?: string; date?: string } {
  const params = new URLSearchParams(search);
  const out: { postId?: string; date?: string } = {};
  const post = params.get('post');
  if (post !== null && POST_ID.test(post)) out.postId = post;
  const date = params.get('date');
  if (date !== null && isRealDate(date)) out.date = date;
  return out;
}

/** The query without `post` and `date`, without a leading `?`. */
export function stripCalendarDeepLink(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('post');
  params.delete('date');
  return params.toString();
}
