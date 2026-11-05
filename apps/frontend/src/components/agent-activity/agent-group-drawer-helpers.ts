// Small pure helpers shared by the group drawer and the timeline.

const ERROR_CATEGORIES = new Set([
  "AUTH_EXPIRED",
  "PERMISSION_MISSING",
  "RATE_LIMITED",
  "INVALID_CONTENT",
  "PROVIDER_UNAVAILABLE",
  "UNKNOWN_OUTCOME",
  "POLICY_BLOCKED",
  "UNKNOWN",
]);

/** i18n key for an error category; an unknown or missing category maps to UNKNOWN. */
export function errorKey(category: string | null | undefined): string {
  return `agentActivity.error.${category && ERROR_CATEGORIES.has(category) ? category : "UNKNOWN"}`;
}

/** Only http(s) links are rendered as anchors. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}
