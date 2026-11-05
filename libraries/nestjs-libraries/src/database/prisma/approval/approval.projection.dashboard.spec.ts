import { toDashboardApproval } from './approval.projection';

const future = new Date(Date.now() + 3600_000);
const past = new Date(Date.now() - 3600_000);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  postId: 'p1',
  organizationId: 'org-1',
  status: 'PENDING',
  note: null,
  requestedAt: new Date('2026-11-01T00:00:00Z'),
  resolvedAt: null,
  guestToken: 'PLAINTEXT-SECRET',
  guestTokenHash: 'HASH-SECRET',
  guestTokenExpiresAt: future,
  requestedById: 'u-requester',
  approverId: 'u-approver',
  guestEmail: 'guest@example.com',
  guestName: 'Guest Name',
  requestedBy: { name: 'Ann', email: 'ann@example.com', id: 'u-requester' },
  post: { id: 'p1', content: 'hi', group: 'g' },
  ...over,
});

describe('toDashboardApproval', () => {
  it.each([true, false])('never leaks token material (isAdmin=%s)', (isAdmin) => {
    const out = toDashboardApproval(row(), { isAdmin });
    const json = JSON.stringify(out);
    for (const needle of [
      'guestToken',
      'guestTokenHash',
      'guestTokenExpiresAt',
      'requestedById',
      'approverId',
      'guestEmail',
      'guestName',
      'PLAINTEXT-SECRET',
      'HASH-SECRET',
      'u-requester',
      'u-approver',
      'guest@example.com',
      'organizationId',
    ]) {
      expect(json).not.toContain(needle);
    }
  });

  it('picks the public fields and defaults stage data', () => {
    const out = toDashboardApproval(row(), { isAdmin: false });
    expect(out).toMatchObject({
      id: 'a1',
      postId: 'p1',
      status: 'PENDING',
      note: null,
      resolvedAt: null,
      requestedBy: { name: 'Ann', email: 'ann@example.com' },
      post: { id: 'p1', content: 'hi', group: 'g' },
      stage: null,
      stages: [],
      hasGuestLink: false,
    });
    expect(out.requestedBy).toEqual({ name: 'Ann', email: 'ann@example.com' });
    expect(out).not.toHaveProperty('guestLinkExpiresAt');
  });

  it('shows the link flag only to admins with an unexpired hash', () => {
    const admin = toDashboardApproval(row(), { isAdmin: true });
    expect(admin.hasGuestLink).toBe(true);
    expect(admin.guestLinkExpiresAt).toEqual(future);

    expect(toDashboardApproval(row(), { isAdmin: false }).hasGuestLink).toBe(false);

    const expired = toDashboardApproval(row({ guestTokenExpiresAt: past }), { isAdmin: true });
    expect(expired.hasGuestLink).toBe(false);
    expect(expired.guestLinkExpiresAt).toBeNull();

    const noHash = toDashboardApproval(
      row({ guestTokenHash: null, guestTokenExpiresAt: future }),
      { isAdmin: true }
    );
    expect(noHash.hasGuestLink).toBe(false);
  });

  it('omits requestedBy and post when the row does not carry them', () => {
    const out = toDashboardApproval(row({ requestedBy: undefined, post: undefined }), { isAdmin: true });
    expect(out).not.toHaveProperty('requestedBy');
    expect(out).not.toHaveProperty('post');
  });

  it('passes stage data through when present', () => {
    const stage = { position: 1, name: 'Legal' };
    const out = toDashboardApproval(
      row({ stage, stages: [stage] }),
      { isAdmin: false }
    );
    expect(out.stage).toEqual(stage);
    expect(out.stages).toEqual([stage]);
  });
});
