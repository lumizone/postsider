/**
 * Removes a webhook target URL (a Slack incoming webhook URL is itself a
 * secret) from free text before it is stored or logged. Replaces the full
 * URL, host plus path, and the bare path.
 */
export function redactUrl(text: string, url: string): string {
  if (!text || !url) return text;
  const candidates = new Set<string>([url]);
  try {
    const parsed = new URL(url);
    candidates.add(parsed.href);
    const path = `${parsed.pathname}${parsed.search}`;
    candidates.add(`${parsed.host}${path}`);
    candidates.add(`${parsed.hostname}${path}`);
    // A bare "/" path would blank out unrelated text.
    if (parsed.pathname.length > 1) {
      candidates.add(path);
      candidates.add(parsed.pathname);
    }
  } catch {
    // Not parsable: only the literal string is replaced.
  }
  // Longest first so a shorter variant never leaves a fragment of a longer one.
  const ordered = [...candidates]
    .filter((candidate) => candidate.length > 1)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const candidate of ordered) {
    out = out.split(candidate).join('[url]');
  }
  return out;
}
