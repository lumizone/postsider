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
    const trailing = url.match(/[).,!?]+$/)?.[0] ?? '';
    const clean = trailing ? url.slice(0, -trailing.length) : url;
    if (/[?&]utm_source=/.test(clean)) return url; // already tagged
    const sep = clean.includes('?') ? '&' : '?';
    return clean + sep + query + trailing;
  });
}
