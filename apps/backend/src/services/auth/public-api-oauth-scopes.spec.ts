import { publicApiScopesForOAuth } from './public-api-oauth-scopes';

describe('Public API OAuth grant translation', () => {
  it('keeps legacy OAuth access to existing routes but never new webhook administration', () => {
    const legacy = publicApiScopesForOAuth(undefined);
    expect(legacy).toContain('posts:write');
    expect(legacy).toContain('channels:write');
    expect(legacy).not.toContain('webhooks:read');
    expect(legacy).not.toContain('webhooks:write');
  });

  it('keeps a read-only MCP grant read-only in the API', () => {
    const scopes = publicApiScopesForOAuth(['posts:read', 'openid', 'email']);
    expect(scopes).toEqual(expect.arrayContaining([
      'posts:read', 'channels:read', 'organization:read', 'publishing:read',
    ]));
    expect(scopes).not.toContain('posts:write');
    expect(scopes).not.toContain('channels:write');
    expect(scopes).not.toContain('webhooks:write');
  });

  it('maps explicit MCP writing rights without elevating webhook rights', () => {
    const scopes = publicApiScopesForOAuth(['posts:write', 'channels:write']);
    expect(scopes).toContain('posts:write');
    expect(scopes).toContain('media:write');
    expect(scopes).toContain('channels:write');
    expect(scopes).not.toContain('webhooks:write');
  });

  it.each([[], ['admin:all'], ['webhooks:write'], ['*']])(
    'unsupported OAuth grant %j never escalates rights',
    (input) => {
      const scopes = publicApiScopesForOAuth(input);
      expect(scopes).not.toContain('webhooks:write');
      expect(scopes).not.toContain('webhooks:read');
      expect(scopes).not.toContain('posts:write');
    }
  );

  it('rejects malformed OAuth grants rather than granting legacy compatibility', () => {
    expect(publicApiScopesForOAuth({} as any)).toEqual([]);
  });
});
