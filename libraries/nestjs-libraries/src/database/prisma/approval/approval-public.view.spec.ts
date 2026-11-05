jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import {
  decodeCursor,
  encodeCursor,
  previewOf,
  toPublicApprovalItem,
} from './approval-public.view';

const row = (over: Record<string, any> = {}) => ({
  id: 'a1',
  postId: 'p1',
  status: 'PENDING',
  note: null,
  requestedAt: new Date('2026-11-01T10:00:00.000Z'),
  resolvedAt: null,
  requestedByType: 'API_KEY',
  requestedByApiKeyId: 'k1',
  requestedById: 'u-internal',
  guestToken: 'secret',
  guestTokenHash: 'hash',
  guestTokenExpiresAt: new Date(),
  organizationId: 'org-1',
  approverId: null,
  decidedByType: null,
  currentStage: 1,
  stages: [],
  post: { integration: { id: 'c1', name: 'Page', providerIdentifier: 'x', picture: 'p', internalId: 'z' } },
  ...over,
});

describe('toPublicApprovalItem', () => {
  it('picks explicit fields and never leaks token material, requester id or organization id', () => {
    const item = toPublicApprovalItem(row(), { id: 'f1', name: 'Flow', secret: 1 } as any);
    const json = JSON.stringify(item);
    expect(json).not.toMatch(/guestToken|requestedById|organizationId|u-internal|secret|hash/);
    expect(item).toMatchObject({
      id: 'a1',
      postId: 'p1',
      status: 'PENDING',
      requestedBy: { type: 'API_KEY', apiKeyId: 'k1' },
      decidedBy: null,
      stage: { position: 1, total: 1, name: 'Approval' },
      flow: { id: 'f1', name: 'Flow' },
      channel: { id: 'c1', name: 'Page', providerIdentifier: 'x' },
    });
    expect(Object.keys(item.channel as object).sort()).toEqual(['id', 'name', 'providerIdentifier']);
  });

  it('shows stage progress and the key that decided', () => {
    const item = toPublicApprovalItem(
      row({
        status: 'REJECTED',
        decidedByType: 'API_KEY',
        decidedByApiKeyId: 'k2',
        currentStage: 2,
        stages: [
          { position: 1, name: 'A', status: 'APPROVED', decidedByType: 'USER', decidedByUserId: 'u1', decidedAt: new Date() },
          { position: 2, name: 'B', status: 'REJECTED', decidedByType: 'API_KEY', decidedByApiKeyId: 'k2', decidedAt: new Date() },
        ],
      }),
      null
    );
    expect(item.stage).toEqual({ position: 2, total: 2, name: 'B' });
    expect(item.stages.map((s) => s.status)).toEqual(['APPROVED', 'REJECTED']);
    expect(item.decidedBy).toEqual({ type: 'API_KEY', apiKeyId: 'k2' });
    expect(item.flow).toBeNull();
  });

  it('a pending approval has no decidedBy and a missing channel is null', () => {
    const item = toPublicApprovalItem(row({ post: null, decidedByType: 'USER' }), null);
    expect(item.decidedBy).toBeNull();
    expect(item.channel).toBeNull();
  });
});

describe('previewOf', () => {
  it('is plain text cut to 500 characters', () => {
    const text = previewOf('<p>Hello <b>world</b></p>' + '<p>x</p>'.repeat(300));
    expect(text.startsWith('Hello world')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).not.toContain('<');
  });
  it('is empty for missing content and survives oversized markup', () => {
    expect(previewOf(undefined)).toBe('');
    expect(previewOf('')).toBe('');
    expect(previewOf('<p>a</p>'.repeat(20_000)).length).toBeLessThanOrEqual(500);
  });
});

describe('cursor', () => {
  it('round trips', () => {
    const at = new Date('2026-11-01T10:00:00.123Z');
    expect(decodeCursor(encodeCursor({ requestedAt: at, id: 'abc-1' }))).toEqual({
      requestedAt: at,
      id: 'abc-1',
    });
  });
  it.each(['', '!!!', 'bm9waXBl', Buffer.from('2026-13-45T00:00:00.000Z|x').toString('base64url'),
    Buffer.from('2026-11-01T10:00:00.000Z|bad id!').toString('base64url'),
    Buffer.from('2026-11-01T10:00:00.000Z|').toString('base64url')])('rejects %j', (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});
