// Cleans untrusted display names (OAuth client names, claimed agent names, etc).

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

export function cleanDisplayName(raw: unknown, max = 80): string | null {
  if (typeof raw !== 'string') return null;
  // line breaks and tabs act as spaces, every other control character is dropped
  const cleaned = raw
    .replace(/[\t\n\r]/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
