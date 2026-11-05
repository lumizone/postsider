/**
 * Maps the dashboard post type to the write type a policy is evaluated for.
 * An edit of a stored post ('update') is evaluated as a schedule, and so is
 * anything unknown, so a malformed type never weakens the check.
 */
export function dashboardPolicyType(type: unknown): 'draft' | 'schedule' | 'now' {
  if (type === 'draft') return 'draft';
  if (type === 'now') return 'now';
  return 'schedule';
}
