// Pure URL UTM-tagging used by the composer "UTM" helper.
// Kept free of React/DOM so it can be unit-tested in a node jest env.

export interface UtmPresetInput {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent?: string | null;
  utmTerm?: string | null;
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

/**
 * Append the preset's UTM parameters to every URL in `body`.
 * - URLs that already carry a utm_source are left untouched.
 * - Uses `?` or `&` depending on whether the URL already has a query string.
 * - Trailing sentence punctuation (.,!?) is kept outside the appended params.
 */
export function appendUtmParams(body: string, preset: UtmPresetInput): string {
  if (!body) return body;

  const pairs: Array<[string, string]> = [
    ['utm_source', preset.utmSource],
    ['utm_medium', preset.utmMedium],
    ['utm_campaign', preset.utmCampaign],
  ];
  if (preset.utmContent) pairs.push(['utm_content', preset.utmContent]);
  if (preset.utmTerm) pairs.push(['utm_term', preset.utmTerm]);
  const query = pairs
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  return body.replace(URL_RE, (url) => {
    // Peel trailing sentence punctuation, but KEEP a ')' that closes a '(' in
    // the URL path itself (e.g. wikipedia .../Foo_(bar)). Only an unbalanced
    // ')' is punctuation (e.g. "(see https://x.com)").
    let clean = url;
    let trailing = '';
    for (;;) {
      const last = clean[clean.length - 1];
      if (last === '.' || last === ',' || last === '!' || last === '?') {
        trailing = last + trailing;
        clean = clean.slice(0, -1);
      } else if (last === ')') {
        const opens = (clean.match(/\(/g) || []).length;
        const closes = (clean.match(/\)/g) || []).length;
        if (closes <= opens) break; // balanced — part of the URL
        trailing = last + trailing;
        clean = clean.slice(0, -1);
      } else {
        break;
      }
    }
    if (/[?&]utm_source=/.test(clean)) return url; // already tagged
    // Insert params before the fragment — appending after '#section' would put
    // them inside the fragment where no URL consumer parses them.
    const hashIdx = clean.indexOf('#');
    const base = hashIdx === -1 ? clean : clean.slice(0, hashIdx);
    const hash = hashIdx === -1 ? '' : clean.slice(hashIdx);
    const sep = base.includes('?') ? '&' : '?';
    return base + sep + query + hash + trailing;
  });
}
