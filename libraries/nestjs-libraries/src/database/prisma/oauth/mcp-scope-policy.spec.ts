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

  describe('policy dry run', () => {
    it.each([
      '/public/v1/policies/evaluate',
      '/public/v1/policies/evaluate?x=/integrations',
      '/public/v1/policies/evaluate/',
      '/public/v1/Policies/EVALUATE',
      '/PUBLIC/V1/policies/evaluate/?a=1#b',
      '/public/v1//policies//evaluate',
    ])('POST %s is a read', (url) => {
      expect(requiredScopeFor('POST', url)).toBe('posts:read');
    });

    it('stays a write for every other policy route and verb', () => {
      expect(requiredScopeFor('POST', '/public/v1/policies')).toBe('posts:write');
      expect(requiredScopeFor('PUT', '/public/v1/policies/x')).toBe('posts:write');
      expect(requiredScopeFor('DELETE', '/public/v1/policies/evaluate')).toBe('posts:write');
      expect(requiredScopeFor('PUT', '/public/v1/policies/evaluate')).toBe('posts:write');
      expect(requiredScopeFor('PATCH', '/public/v1/policies/evaluate')).toBe('posts:write');
      expect(requiredScopeFor('POST', '/public/v1/policies/evaluate/extra')).toBe('posts:write');
      expect(requiredScopeFor('POST', '/public/v1/policies/evaluatex')).toBe('posts:write');
      expect(requiredScopeFor('POST', '/public/v1/policies/x/evaluate')).toBe('posts:write');
      expect(requiredScopeFor('POST', '/public/v1/posts')).toBe('posts:write');
    });

    it('is only a read when every normalised form of the path is the dry run', () => {
      // Express does not decode before matching a literal route, so an encoded
      // spelling never reaches the dry run handler; it must not get the read scope.
      expect(requiredScopeFor('POST', '/public/v1/policies%2Fevaluate')).toBe('posts:write');
      expect(requiredScopeFor('POST', '/public/v1/policies/%65valuate')).toBe('posts:write');
      expect(requiredScopeFor('POST', '/public/v1/policies/evaluate%2F..%2Fx')).toBe('posts:write');
    });
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

  it('lets a read-only grant call the policy dry run, strictly', () => {
    const url = '/public/v1/policies/evaluate?x=1';
    expect(tokenAllows(['posts:read'], 'POST', url)).toEqual({ allowed: true });
    expect(tokenAllows(['posts:write'], 'POST', url)).toEqual({
      allowed: false,
      required: 'posts:read',
    });
    expect(tokenAllows(['posts:read'], 'POST', '/public/v1/posts')).toEqual({
      allowed: false,
      required: 'posts:write',
    });
    expect(tokenAllows(['posts:read'], 'POST', '/public/v1/policies')).toEqual({
      allowed: false,
      required: 'posts:write',
    });
  });

  it('gives an identity-only token no API access at all', () => {
    expect(tokenAllows(['openid', 'email'], 'GET', '/public/v1/posts').allowed).toBe(false);
  });
});
