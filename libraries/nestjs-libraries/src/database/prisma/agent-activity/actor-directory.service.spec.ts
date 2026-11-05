import { ActorDirectoryService } from './actor-directory.service';

const make = (data: {
  members?: any[];
  keys?: any[];
  mcp?: any[];
  apps?: any[];
} = {}) => {
  const members = { findMany: jest.fn().mockResolvedValue(data.members ?? []) };
  const keys = { findMany: jest.fn().mockResolvedValue(data.keys ?? []) };
  const mcp = { findMany: jest.fn().mockResolvedValue(data.mcp ?? []) };
  const apps = { findMany: jest.fn().mockResolvedValue(data.apps ?? []) };
  const svc = new ActorDirectoryService(
    { model: { userOrganization: members } } as any,
    { model: { apiKey: keys } } as any,
    { model: { mcpOAuthClient: mcp } } as any,
    { model: { oAuthApp: apps } } as any
  );
  return { svc, members, keys, mcp, apps };
};

const member = (userId: string, name: string | null, lastName: string | null, email: string) => ({
  userId,
  user: { name, lastName, email },
});

describe('ActorDirectoryService', () => {
  it('issues one deduplicated query per table and none for empty lists', async () => {
    const { svc, members, keys, mcp, apps } = make({
      members: [member('u1', 'Ann', 'Lee', 'a@x.io')],
    });
    await svc.resolve('org-1', [
      { type: 'USER', userId: 'u1' },
      { type: 'USER', userId: 'u1' },
      { type: 'API_KEY', apiKeyId: 'k1' },
      { type: 'API_KEY', apiKeyId: 'k1' },
      { type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u2' },
      { type: 'SYSTEM' },
      null,
      undefined,
    ] as any);
    expect(members.findMany).toHaveBeenCalledTimes(1);
    expect(keys.findMany).toHaveBeenCalledTimes(1);
    expect(mcp.findMany).toHaveBeenCalledTimes(1);
    expect(apps.findMany).toHaveBeenCalledTimes(1);
    const userIds = members.findMany.mock.calls[0][0].where.userId.in;
    expect([...userIds].sort()).toEqual(['u1', 'u2']);
    expect(keys.findMany.mock.calls[0][0].where.id.in).toEqual(['k1']);
    expect(mcp.findMany.mock.calls[0][0].where.id.in).toEqual(['c1']);
    expect(apps.findMany.mock.calls[0][0].where.id.in).toEqual(['c1']);
  });

  it('issues no query when there are no ids', async () => {
    const { svc, members, keys, mcp, apps } = make();
    await svc.resolve('org-1', [{ type: 'SYSTEM' }, { type: 'API_KEY' }, null]);
    for (const m of [members, keys, mcp, apps]) expect(m.findMany).not.toHaveBeenCalled();
  });

  it('scopes tenant tables by organization and never selects the key secret', async () => {
    const { svc, members, keys, apps } = make();
    await svc.resolve('org-1', [
      { type: 'USER', userId: 'u1' },
      { type: 'API_KEY', apiKeyId: 'k1' },
      { type: 'OAUTH_CLIENT', oauthClientId: 'c1' },
    ]);
    expect(members.findMany.mock.calls[0][0].where.organizationId).toBe('org-1');
    expect(keys.findMany.mock.calls[0][0].where.organizationId).toBe('org-1');
    expect(apps.findMany.mock.calls[0][0].where.organizationId).toBe('org-1');
    const sel = keys.findMany.mock.calls[0][0].select;
    expect(sel).toBeDefined();
    expect(sel).not.toHaveProperty('key');
  });

  it('resolves a mixed list', async () => {
    const { svc } = make({
      members: [member('u1', 'Ann', 'Lee', 'a@x.io'), member('u3', null, null, 'only@x.io')],
      keys: [
        { id: 'k1', name: 'ci', deletedAt: new Date() },
        { id: 'k2', name: 'live', deletedAt: null },
      ],
      mcp: [{ id: 'c1', name: 'Claude' }],
      apps: [{ id: 'c2', name: 'My app' }],
    });
    const r = await svc.resolve('org-1', []);
    expect(r(null)).toBeNull();
    const r2 = await svc.resolve('org-1', [
      { type: 'USER', userId: 'u1' },
      { type: 'USER', userId: 'u3' },
      { type: 'API_KEY', apiKeyId: 'k2' },
      { type: 'OAUTH_CLIENT', oauthClientId: 'c1' },
      { type: 'OAUTH_CLIENT', oauthClientId: 'c2' },
    ]);
    expect(r2({ type: 'USER', userId: 'u1' })).toEqual({
      type: 'USER', id: 'u1', name: 'Ann Lee', state: 'ok', authorizedBy: null,
    });
    expect(r2({ type: 'USER', userId: 'u3' })?.name).toBe('only@x.io');
    expect(r2({ type: 'API_KEY', apiKeyId: 'k2' })).toMatchObject({ name: 'live', state: 'ok' });
    expect(r2({ type: 'OAUTH_CLIENT', oauthClientId: 'c1' })).toMatchObject({ name: 'Claude', state: 'ok' });
    expect(r2({ type: 'OAUTH_CLIENT', oauthClientId: 'c2' })).toMatchObject({ name: 'My app', state: 'ok' });
    expect(r2({ type: 'SYSTEM' })).toEqual({
      type: 'SYSTEM', id: null, name: null, state: 'ok', authorizedBy: null,
    });
  });

  it('marks revoked, unknown and legacy keys', async () => {
    const { svc } = make({ keys: [{ id: 'k1', name: 'ci', deletedAt: new Date() }] });
    const r = await svc.resolve('org-1', [
      { type: 'API_KEY', apiKeyId: 'k1' },
      { type: 'API_KEY', apiKeyId: 'gone' },
      { type: 'API_KEY' },
      { type: 'OAUTH_CLIENT', oauthClientId: 'nope' },
    ]);
    expect(r({ type: 'API_KEY', apiKeyId: 'k1' })).toMatchObject({ state: 'revoked', name: 'ci' });
    expect(r({ type: 'API_KEY', apiKeyId: 'gone' })).toMatchObject({ state: 'unknown', name: null, id: 'gone' });
    expect(r({ type: 'API_KEY' })).toEqual({
      type: 'API_KEY', id: null, name: null, state: 'legacy', authorizedBy: null,
    });
    expect(r({ type: 'OAUTH_CLIENT', oauthClientId: 'nope' })).toMatchObject({ state: 'unknown', name: null });
  });

  it('fills authorizedBy for OAuth clients and cleans control characters', async () => {
    const { svc } = make({
      members: [member('u1', 'Ann\u0007\n', 'Lee', 'a@x.io')],
      mcp: [{ id: 'c1', name: 'Bad\u0000 name\r\nx' }],
    });
    const r = await svc.resolve('org-1', [
      { type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u1' },
    ]);
    const d = r({ type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u1' });
    expect(d?.authorizedBy).toBe('Ann Lee');
    expect(d?.name).toBe('Bad name x');
  });

  it('treats a user outside the organization as unknown', async () => {
    const { svc } = make({ members: [] });
    const r = await svc.resolve('org-1', [{ type: 'USER', userId: 'left' }]);
    expect(r({ type: 'USER', userId: 'left' })).toEqual({
      type: 'USER', id: 'left', name: null, state: 'unknown', authorizedBy: null,
    });
  });

  it('returns null for null and undefined views', async () => {
    const { svc } = make();
    const r = await svc.resolve('org-1', []);
    expect(r(null)).toBeNull();
    expect(r(undefined)).toBeNull();
  });

  it('cuts long names to 80 characters', async () => {
    const { svc } = make({ keys: [{ id: 'k1', name: 'a'.repeat(200), deletedAt: null }] });
    const r = await svc.resolve('org-1', [{ type: 'API_KEY', apiKeyId: 'k1' }]);
    expect(r({ type: 'API_KEY', apiKeyId: 'k1' })?.name).toHaveLength(80);
  });
});
