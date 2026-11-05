import {
  calendarDateParam,
  destinationLinkVisibility,
  groupActionVisibility,
  pendingApprovalIdsOf,
  retryFlag,
  summarizeBulk,
  summarizeRetry,
} from './agent-activity-actions';

const base = { canRetry: true, buckets: [] as never[], pendingCount: 0 };

describe('groupActionVisibility', () => {
  it('shows nothing to a USER, whatever the group holds', () => {
    const v = groupActionVisibility({
      role: 'USER',
      canRetry: true,
      buckets: ['review', 'retryable', 'unknown_outcome'],
      pendingCount: 3,
    });
    expect(v).toEqual({ approve: false, reject: false, retry: false, retryAnyway: false });
  });

  it('shows nothing when the role is missing or unknown', () => {
    for (const role of [undefined, null, '', 'MEMBER']) {
      const v = groupActionVisibility({ role, canRetry: true, buckets: ['retryable'], pendingCount: 1 });
      expect(v).toEqual({ approve: false, reject: false, retry: false, retryAnyway: false });
    }
  });

  it('shows approve and reject to ADMIN and SUPERADMIN only with a pending approval', () => {
    for (const role of ['ADMIN', 'SUPERADMIN']) {
      expect(groupActionVisibility({ ...base, role, pendingCount: 1 })).toMatchObject({
        approve: true,
        reject: true,
      });
      expect(groupActionVisibility({ ...base, role, pendingCount: 0 })).toMatchObject({
        approve: false,
        reject: false,
      });
    }
  });

  it('shows plain retry for retryable and failed_other, never for unknown_outcome alone', () => {
    expect(groupActionVisibility({ ...base, role: 'ADMIN', buckets: ['retryable'] }).retry).toBe(true);
    expect(groupActionVisibility({ ...base, role: 'ADMIN', buckets: ['failed_other'] }).retry).toBe(true);
    const only = groupActionVisibility({ ...base, role: 'ADMIN', buckets: ['unknown_outcome'] });
    expect(only.retry).toBe(false);
    expect(only.retryAnyway).toBe(true);
  });

  it('shows both retry buttons when failures and an unknown outcome mix', () => {
    const v = groupActionVisibility({
      ...base,
      role: 'ADMIN',
      buckets: ['retryable', 'unknown_outcome'],
    });
    expect(v.retry).toBe(true);
    expect(v.retryAnyway).toBe(true);
  });

  it('hides every retry button when the group cannot be retried', () => {
    const v = groupActionVisibility({
      ...base,
      role: 'ADMIN',
      canRetry: false,
      buckets: ['retryable', 'unknown_outcome'],
    });
    expect(v.retry).toBe(false);
    expect(v.retryAnyway).toBe(false);
  });

  it('shows no retry for published, scheduled or review groups', () => {
    const v = groupActionVisibility({
      ...base,
      role: 'ADMIN',
      buckets: ['published', 'scheduled', 'review', 'draft', 'held', 'blocked'],
    });
    expect(v.retry).toBe(false);
    expect(v.retryAnyway).toBe(false);
  });
});

describe('destinationLinkVisibility', () => {
  it('offers the editor for editable states but not to a USER', () => {
    for (const state of ['DRAFT', 'QUEUE', 'APPROVAL', 'ERROR', 'HELD']) {
      expect(destinationLinkVisibility({ role: 'ADMIN', state, hasReleaseUrl: false }).openEditor).toBe(true);
      expect(destinationLinkVisibility({ role: 'USER', state, hasReleaseUrl: false }).openEditor).toBe(false);
    }
    expect(destinationLinkVisibility({ role: 'ADMIN', state: 'PUBLISHED', hasReleaseUrl: true }).openEditor).toBe(
      false,
    );
  });

  it('offers the calendar to everyone and the platform link only for published posts with a url', () => {
    const user = destinationLinkVisibility({ role: 'USER', state: 'PUBLISHED', hasReleaseUrl: true });
    expect(user.openCalendar).toBe(true);
    expect(user.viewOnPlatform).toBe(true);
    expect(destinationLinkVisibility({ role: 'USER', state: 'PUBLISHED', hasReleaseUrl: false }).viewOnPlatform).toBe(
      false,
    );
    expect(destinationLinkVisibility({ role: 'ADMIN', state: 'QUEUE', hasReleaseUrl: true }).viewOnPlatform).toBe(
      false,
    );
  });
});

describe('retryFlag', () => {
  it('sends false for a plain retry whatever the checkbox says', () => {
    expect(retryFlag('plain', false)).toBe(false);
    expect(retryFlag('plain', true)).toBe(false);
  });

  it('sends true for retry anyway only after the box is ticked', () => {
    expect(retryFlag('anyway', false)).toBe(false);
    expect(retryFlag('anyway', true)).toBe(true);
  });
});

describe('pendingApprovalIdsOf', () => {
  it('collects only PENDING approvals and drops duplicates', () => {
    expect(
      pendingApprovalIdsOf([
        { approval: { id: 'a', status: 'PENDING' } },
        { approval: { id: 'b', status: 'APPROVED' } },
        { approval: null },
        { approval: { id: 'a', status: 'PENDING' } },
        { approval: { id: 'c', status: 'PENDING' } },
      ]),
    ).toEqual(['a', 'c']);
  });
});

describe('calendarDateParam', () => {
  it('formats the local calendar date', () => {
    const iso = new Date(2026, 10, 4, 23, 30).toISOString();
    expect(calendarDateParam(iso)).toBe('2026-11-04');
    expect(calendarDateParam(new Date(2026, 0, 5, 0, 5).toISOString())).toBe('2026-01-05');
  });

  it('returns null for an invalid date', () => {
    expect(calendarDateParam('nope')).toBeNull();
  });
});

describe('summarizers', () => {
  it('counts retry outcomes', () => {
    expect(
      summarizeRetry([
        { action: 'requeued' },
        { action: 'requeued' },
        { action: 'skipped' },
        { action: 'approval_requested' },
      ]),
    ).toEqual({ requeued: 2, skipped: 1, approval: 1 });
  });

  it('passes the bulk summary through and flags failures', () => {
    expect(summarizeBulk({ done: 2, skipped: 0, failed: 0 })).toEqual({ done: 2, skipped: 0, failed: 0, hasFailures: false });
    expect(summarizeBulk({ done: 1, skipped: 0, failed: 1 }).hasFailures).toBe(true);
  });
});
