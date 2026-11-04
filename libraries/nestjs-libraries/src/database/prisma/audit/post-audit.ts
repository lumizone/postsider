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
