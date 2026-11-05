import dayjs from 'dayjs';
import type { AuditLogger } from './audit.logger';
import type { ResourceAuditEntry } from './audit-events';

/**
 * Best-effort post audit write. Never throws and never rejects: auditing must
 * not delay or fail publishing, approval or an API response.
 */
export async function recordPostEvent(
  audit: AuditLogger | undefined,
  entry: ResourceAuditEntry
): Promise<void> {
  if (!audit) return;
  try {
    await audit.logResourceEvent(entry);
  } catch {
    // swallowed on purpose
  }
}

/**
 * Never-throwing ISO string for audit metadata. Accepts anything dayjs or Date
 * can parse; returns null for invalid input instead of raising a RangeError
 * outside the best-effort wrapper.
 */
export function safeIsoDate(value: unknown): string | null {
  try {
    if (value === null || value === undefined) return null;
    const d = value instanceof Date ? value : dayjs(value as any).toDate();
    const t = d.getTime();
    return Number.isNaN(t) ? null : d.toISOString();
  } catch {
    return null;
  }
}
