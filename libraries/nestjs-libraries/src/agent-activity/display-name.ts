// Cleans untrusted display names (OAuth client names, claimed agent names, etc).

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

// bidi overrides and isolates, zero-width characters and the BOM: they can reorder
// or hide text next to the name in the UI
const INVISIBLE_CHARS =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export function cleanDisplayName(raw: unknown, max = 80): string | null {
  if (typeof raw !== 'string') return null;
  // line breaks and tabs act as spaces, every other control character is dropped
  const cleaned = raw
    .replace(/[\t\n\r]/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  // cut by code points so an emoji is never split into a lone surrogate
  const cut = Array.from(cleaned).slice(0, max).join('').trim();
  return cut.length > 0 ? cut : null;
}
