import { BadRequestException } from '@nestjs/common';
import { AuditEventsService } from './audit-events.service';

function setup(rows: any[] = []) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const service = new AuditEventsService({ model: { auditLog: { findMany } } } as any);
  return { service, findMany };
}

const row = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `id-${i}`,
  createdAt: new Date(Date.UTC(2026, 0, 10, 0, 0, 100 - i)),
  operation: 'post.created',
  targetType: 'post',
  targetId: 'p1',
  actorType: 'USER',
  actorUserId: 'u1',
  actorApiKeyId: null,
  actorOAuthClientId: null,
  metadata: { a: 1 },
  correlationId: 'c',
  inputHash: 'h',
  organizationId: 'org-1',
  ...extra,
});

describe('AuditEventsService.list', () => {
  it('scopes by organization and requires a target type', async () => {
    const { service, findMany } = setup();
    await service.list('org-1', { limit: 25 });
    const args = findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ organizationId: 'org-1', targetType: { not: null } });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(26);
  });

  it('maps filters', async () => {
    const { service, findMany } = setup();
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    await service.list('org-1', {
      limit: 10, targetType: 'post', targetIds: ['a', 'b'], type: 'post.published', from, to,
    });
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org-1',
      targetType: 'post',
      targetId: { in: ['a', 'b'] },
      operation: 'post.published',
      createdAt: { gte: from, lte: to },
    });
    expect(findMany.mock.calls[0][0].take).toBe(11);
  });

  it('returns empty without querying for empty targetIds', async () => {
    const { service, findMany } = setup();
    expect(await service.list('org-1', { limit: 5, targetIds: [] })).toEqual({ events: [], nextCursor: null });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns a cursor to the last returned row when an extra row exists', async () => {
    const { service } = setup([row(1), row(2), row(3)]);
    const res = await service.list('org-1', { limit: 2 });
    expect(res.events).toHaveLength(2);
    expect(res.nextCursor).not.toBeNull();
    expect(AuditEventsService.decodeCursor(res.nextCursor!)).toEqual({
      createdAt: row(2).createdAt,
      id: 'id-2',
    });
  });

  it('has no cursor when fewer rows than limit + 1', async () => {
    const { service } = setup([row(1), row(2)]);
    const res = await service.list('org-1', { limit: 2 });
    expect(res.events).toHaveLength(2);
    expect(res.nextCursor).toBeNull();
  });

  it('adds a keyset clause for a cursor', async () => {
    const { service, findMany } = setup();
    const createdAt = new Date('2026-01-05T00:00:00.000Z');
    await service.list('org-1', { limit: 5, cursor: AuditEventsService.encodeCursor(createdAt, 'x1') });
    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: 'x1' } },
    ]);
  });

  it.each([
    ['not base64 json', '###'],
    ['missing fields', Buffer.from(JSON.stringify({ x: 1 })).toString('base64url')],
    ['bad date', Buffer.from(JSON.stringify({ t: 'nope', i: 'a' })).toString('base64url')],
    ['non-string id', Buffer.from(JSON.stringify({ t: '2026-01-01T00:00:00.000Z', i: { $gt: '' } })).toString('base64url')],
  ])('rejects a tampered cursor (%s) before querying', async (_n, cursor) => {
    const { service, findMany } = setup();
    await expect(service.list('org-1', { limit: 5, cursor })).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('AuditEventsService.toItem', () => {
  it('maps an API key actor', () => {
    const item = AuditEventsService.toItem(row(1, { actorType: 'API_KEY', actorUserId: null, actorApiKeyId: 'k1' }));
    expect(item.actor).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
    expect(item.type).toBe('post.created');
    expect(item.target).toEqual({ type: 'post', id: 'p1' });
  });

  it('maps a user actor', () => {
    expect(AuditEventsService.toItem(row(1)).actor).toEqual({ type: 'USER', userId: 'u1' });
  });

  it('maps an oauth client actor', () => {
    const item = AuditEventsService.toItem(row(1, { actorType: 'OAUTH_CLIENT', actorUserId: null, actorOAuthClientId: 'o1' }));
    expect(item.actor).toEqual({ type: 'OAUTH_CLIENT', oauthClientId: 'o1' });
  });

  it('maps a null actor to GUEST or SYSTEM', () => {
    expect(AuditEventsService.toItem(row(1, { actorType: null, actorUserId: null, metadata: { by: 'guest' } })).actor).toEqual({ type: 'GUEST' });
    expect(AuditEventsService.toItem(row(1, { actorType: null, actorUserId: null })).actor).toEqual({ type: 'SYSTEM' });
  });

  it('maps null metadata to {} and hides internals', () => {
    const item = AuditEventsService.toItem(row(1, { metadata: null }));
    expect(item.metadata).toEqual({});
    expect(item).not.toHaveProperty('correlationId');
    expect(item).not.toHaveProperty('inputHash');
    expect(item).not.toHaveProperty('organizationId');
  });
});
