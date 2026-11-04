import { checkKeyPermission } from './key-permissions';

describe('checkKeyPermission', () => {
  it('allows when there are no permissions', () => {
    expect(checkKeyPermission(null, 'PUBLISH_NOW', ['a'])).toEqual({ allowed: true });
    expect(checkKeyPermission(undefined, 'DRAFT', [])).toEqual({ allowed: true });
  });

  it('treats empty lists as unrestricted', () => {
    const perms = { allowedActions: [], allowedIntegrationIds: [] };
    for (const a of ['DRAFT', 'SCHEDULE', 'PUBLISH_NOW'] as const) {
      expect(checkKeyPermission(perms, a, ['x', 'y'])).toEqual({ allowed: true });
    }
  });

  it('rejects an action outside the allowed list', () => {
    expect(
      checkKeyPermission({ allowedActions: ['DRAFT'], allowedIntegrationIds: [] }, 'SCHEDULE', ['a'])
    ).toEqual({
      allowed: false,
      code: 'key_action_not_allowed',
      action: 'SCHEDULE',
      allowedActions: ['DRAFT'],
    });
  });

  it('allows an action inside the allowed list', () => {
    expect(
      checkKeyPermission({ allowedActions: ['DRAFT', 'SCHEDULE'], allowedIntegrationIds: [] }, 'SCHEDULE', [])
    ).toEqual({ allowed: true });
  });

  it('reports the first offending channel', () => {
    expect(
      checkKeyPermission({ allowedActions: [], allowedIntegrationIds: ['a'] }, 'DRAFT', ['a', 'b', 'c'])
    ).toEqual({
      allowed: false,
      code: 'key_channel_not_allowed',
      integrationId: 'b',
      allowedIntegrationIds: ['a'],
    });
  });

  it('fails closed on a missing or empty channel id when a channel limit exists', () => {
    for (const bad of [undefined, '', null]) {
      const r = checkKeyPermission(
        { allowedActions: [], allowedIntegrationIds: ['a'] },
        'DRAFT',
        ['a', bad as any]
      );
      expect(r).toMatchObject({ allowed: false, code: 'key_channel_not_allowed' });
    }
  });

  it('does not require a channel id when the key has no channel limit', () => {
    expect(
      checkKeyPermission({ allowedActions: [], allowedIntegrationIds: [] }, 'DRAFT', [undefined as any])
    ).toEqual({ allowed: true });
  });

  it('checks the action before the channels', () => {
    const r = checkKeyPermission(
      { allowedActions: ['DRAFT'], allowedIntegrationIds: ['a'] },
      'PUBLISH_NOW',
      ['b']
    );
    expect(r).toMatchObject({ allowed: false, code: 'key_action_not_allowed' });
  });

  it('passes the channel check for an empty channel list', () => {
    expect(
      checkKeyPermission({ allowedActions: [], allowedIntegrationIds: ['a'] }, 'DRAFT', [])
    ).toEqual({ allowed: true });
  });
});
