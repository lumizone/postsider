import { approvalDecidedByView, toPublicApproval, toStageView, withStageView } from './approval.projection';

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

describe('approvalDecidedByView with automation deciders', () => {
  it('maps an API_KEY decision to the key id', () => {
    expect(
      approvalDecidedByView({ decidedByType: 'API_KEY', decidedByApiKeyId: 'k2' })
    ).toEqual({ type: 'API_KEY', apiKeyId: 'k2' });
  });
  it('a legacy key without an id stays typed only', () => {
    expect(approvalDecidedByView({ decidedByType: 'API_KEY', decidedByApiKeyId: null })).toEqual({
      type: 'API_KEY',
    });
  });
  it('maps an OAUTH_CLIENT decision', () => {
    expect(
      approvalDecidedByView({ decidedByType: 'OAUTH_CLIENT', decidedByOAuthClientId: 'c1' })
    ).toEqual({ type: 'OAUTH_CLIENT', oauthClientId: 'c1' });
  });
});

describe('toStageView', () => {
  const stage = (position: number, status: string, over: Record<string, unknown> = {}) => ({
    position,
    name: `S${position}`,
    status,
    approverUserIds: ['secret-user'],
    decidedByType: null,
    decidedByUserId: null,
    decidedAt: null,
    ...over,
  });

  it('is the single implicit stage for an approval without rows', () => {
    const view = toStageView({ status: 'PENDING', currentStage: 1 });
    expect(view.stage).toEqual({ position: 1, total: 1, name: 'Approval' });
    expect(view.stages).toEqual([
      { position: 1, name: 'Approval', status: 'PENDING', decidedBy: null, decidedAt: null },
    ]);
  });

  it('carries the decider of a resolved implicit approval', () => {
    const at = new Date('2026-11-05T10:00:00Z');
    const view = toStageView({
      status: 'APPROVED',
      currentStage: 1,
      decidedByType: 'API_KEY',
      decidedByApiKeyId: 'k9',
      resolvedAt: at,
    });
    expect(view.stages[0]).toMatchObject({ status: 'APPROVED', decidedBy: { type: 'API_KEY', apiKeyId: 'k9' }, decidedAt: at });
  });

  it('shows stages after a rejection as NOT_REACHED, in the view only', () => {
    const view = toStageView({
      status: 'REJECTED',
      currentStage: 2,
      stages: [stage(1, 'APPROVED', { decidedByType: 'USER', decidedByUserId: 'u1' }), stage(2, 'REJECTED'), stage(3, 'PENDING')],
    });
    expect(view.stages.map((s) => s.status)).toEqual(['APPROVED', 'REJECTED', 'NOT_REACHED']);
    expect(view.stage).toEqual({ position: 2, total: 3, name: 'S2' });
    expect(view.stages[0].decidedBy).toEqual({ type: 'USER', userId: 'u1' });
  });

  it('shows an API_KEY decider on a stage and exposes no approver lists', () => {
    const view = toStageView({
      status: 'PENDING',
      currentStage: 2,
      stages: [
        stage(1, 'APPROVED', { decidedByType: 'API_KEY', decidedByApiKeyId: 'k1' }),
        stage(2, 'PENDING'),
      ],
    });
    expect(view.stages[0].decidedBy).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
    expect(view.stage.position).toBe(2);
    expect(JSON.stringify(view)).not.toContain('secret-user');
  });

  it('withStageView drops raw rows and token material from the approval', () => {
    const out = withStageView({
      id: 'a1',
      status: 'PENDING',
      currentStage: 1,
      guestTokenHash: 'h',
      stages: [stage(1, 'PENDING')],
    });
    expect(out).toHaveProperty('stage');
    expect(out.stages[0]).not.toHaveProperty('approverUserIds');
    expect(out.stages[0]).not.toHaveProperty('decidedByUserId');
  });
});
