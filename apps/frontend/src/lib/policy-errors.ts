// Pure helpers for policy outcomes returned by the dashboard write paths.
// No React, no API imports.

const MAX_NAMES = 5;
const MAX_NAME_LENGTH = 80;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Cut by code points so an emoji is never split.
  return Array.from(raw.trim()).slice(0, MAX_NAME_LENGTH).join('').trim();
}

/**
 * A 422 body `{ error: 'policy_blocked', policy: { matched: [{ name }] } }`
 * becomes the rule names to show (deduped, 80 characters each, at most 5).
 * Anything else is not a policy block and gives null.
 */
export function parsePolicyBlocked(body: unknown): { ruleNames: string[] } | null {
  if (!isRecord(body) || body.error !== 'policy_blocked') return null;
  const names: string[] = [];
  const policy = body.policy;
  const matched = isRecord(policy) && Array.isArray(policy.matched) ? policy.matched : [];
  for (const m of matched) {
    const name = isRecord(m) ? cleanName(m.name) : '';
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= MAX_NAMES) break;
  }
  return { ruleNames: names };
}

/** The 400 the server sends when the text to check is too large to evaluate. */
export function isPolicyInputTooLarge(body: unknown): boolean {
  return isRecord(body) && body.error === 'policy_input_too_large';
}

/** True when any created post was sent for approval instead of being scheduled. */
export function summarizeCreateResult(created: unknown): { approvalRequested: boolean; blocked: false } {
  const approvalRequested =
    Array.isArray(created) && created.some((c) => isRecord(c) && c.approvalRequested === true);
  return { approvalRequested, blocked: false };
}

export function summarizeDateResult(res: unknown): { approvalRequested: boolean } {
  return { approvalRequested: isRecord(res) && res.approvalRequested === true };
}
