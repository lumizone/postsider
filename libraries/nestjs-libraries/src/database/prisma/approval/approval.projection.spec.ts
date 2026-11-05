import { approvalDecidedByView, toPublicApproval } from './approval.projection';

describe('toPublicApproval', () => {
  const row = {
    id: 'a1',
    postId: 'p1',
    status: 'PENDING',
    note: null,
    requestedAt: new Date('2026-11-01T00:00:00Z'),
    resolvedAt: null,
    guestToken: 'secret',
    guestTokenExpiresAt: new Date(),
    requestedById: 'u-super',
    requestedByType: 'API_KEY',
    requestedByApiKeyId: 'k1',
  };

  it('never exposes the guest token, its expiry or the requester id', () => {
    const out = toPublicApproval(row, true);
    const json = JSON.stringify(out);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('u-super');
    expect(out).not.toHaveProperty('guestToken');
    expect(out).not.toHaveProperty('guestTokenExpiresAt');
    expect(out).not.toHaveProperty('requestedById');
  });

  it('builds requestedBy from the actor columns and carries created', () => {
    expect(toPublicApproval(row, false)).toMatchObject({
      id: 'a1',
      postId: 'p1',
      requestedBy: { type: 'API_KEY', apiKeyId: 'k1' },
      created: false,
    });
    expect(toPublicApproval(row)).not.toHaveProperty('created');
  });
});

describe('approvalDecidedByView', () => {
  it('maps a USER decision using approverId', () => {
    expect(
      approvalDecidedByView({ decidedByType: 'USER', approverId: 'u9' })
    ).toEqual({ type: 'USER', userId: 'u9' });
  });
  it('maps a guest decision', () => {
    expect(
      approvalDecidedByView({
        decidedByType: null,
        guestName: 'Ann',
        guestEmail: 'a@b.co',
      })
    ).toEqual({ type: 'GUEST', guestName: 'Ann', guestEmail: 'a@b.co' });
  });
  it('returns null when undecided', () => {
    expect(approvalDecidedByView({ decidedByType: null })).toBeNull();
  });
});
