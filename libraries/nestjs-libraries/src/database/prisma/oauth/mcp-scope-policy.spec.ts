import { requiredScopeFor, tokenAllows } from './mcp-scope-policy';

describe('requiredScopeFor', () => {
  it.each([
    ['GET', '/public/v1/posts?startDate=a', 'posts:read'],
    ['GET', '/public/v1/integrations', 'posts:read'],
    ['GET', '/public/v1/integrations/c1/queue-plan', 'posts:read'],
    ['GET', '/public/v1/library', 'posts:read'],
    ['POST', '/public/v1/posts', 'posts:write'],
    ['PUT', '/public/v1/posts/p1', 'posts:write'],
    ['DELETE', '/public/v1/media/m1', 'posts:write'],
    ['POST', '/public/v1/library/hashtag-groups', 'posts:write'],
    ['GET', '/public/v1/social/x', 'channels:write'],
    ['POST', '/public/v1/integrations/c1/disable', 'channels:write'],
    ['PUT', '/public/v1/integrations/c1/queue-plan', 'channels:write'],
    ['PUT', '/public/v1/integrations/c1/customer', 'channels:write'],
    ['DELETE', '/public/v1/integrations/c1', 'channels:write'],
  ])('%s %s needs %s', (method, url, expected) => {
    expect(requiredScopeFor(method, url)).toBe(expected);
  });

  it('cannot be dodged with case, trailing slash, query or encoding tricks', () => {
    // Express matches routes case-insensitively and ignores a trailing slash.
    expect(requiredScopeFor('POST', '/public/v1/Integrations/c1/DISABLE')).toBe('channels:write');
    expect(requiredScopeFor('POST', '/PUBLIC/V1/integrations/c1/disable/')).toBe('channels:write');
    expect(requiredScopeFor('GET', '/public/v1/SOCIAL/linkedin')).toBe('channels:write');
    expect(requiredScopeFor('POST', '/public/v1/%69ntegrations/c1/disable')).toBe('channels:write');
    expect(requiredScopeFor('POST', '/public/v1//integrations/c1/disable')).toBe('channels:write');
    expect(requiredScopeFor('DELETE', '/public/v1/integrations/c1?x=/posts')).toBe('channels:write');
  });

  it('treats HEAD/OPTIONS as reads and PATCH as a write', () => {
    expect(requiredScopeFor('HEAD', '/public/v1/posts')).toBe('posts:read');
    expect(requiredScopeFor('PATCH', '/public/v1/posts/p1')).toBe('posts:write');
  });
});

describe('tokenAllows', () => {
  it('lets tokens without a scope list through (API keys, legacy OAuth apps)', () => {
    expect(tokenAllows(undefined, 'POST', '/public/v1/posts')).toEqual({ allowed: true });
  });

  it('blocks a read-only grant from writing and names the scope it lacks', () => {
    expect(tokenAllows(['posts:read'], 'POST', '/public/v1/posts')).toEqual({
      allowed: false,
      required: 'posts:write',
    });
    expect(tokenAllows(['posts:read'], 'GET', '/public/v1/posts')).toEqual({ allowed: true });
  });

  it('keeps channel administration behind its own scope', () => {
    const scopes = ['posts:read', 'posts:write'];
    expect(tokenAllows(scopes, 'POST', '/public/v1/integrations/c1/disable')).toEqual({
      allowed: false,
      required: 'channels:write',
    });
    expect(tokenAllows([...scopes, 'channels:write'], 'POST', '/public/v1/integrations/c1/disable')).toEqual({
      allowed: true,
    });
  });

  it('gives an identity-only token no API access at all', () => {
    expect(tokenAllows(['openid', 'email'], 'GET', '/public/v1/posts').allowed).toBe(false);
  });
});
