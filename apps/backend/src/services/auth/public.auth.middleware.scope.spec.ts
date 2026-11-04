import { ForbiddenException } from '@nestjs/common';
import { PublicAuthMiddleware } from './public.auth.middleware';
import { PublicApiScopeGuard } from './public-api-scope.guard';

describe('PublicAuthMiddleware scope enforcement', () => {
  const org = { id: 'org-1', subscription: { subscriptionTier: 'PRO' } };

  const run = async (
    authorization: any,
    method: string,
    url: string
  ) => {
    const oauth = { getOrgByOAuthToken: jest.fn().mockResolvedValue(authorization) };
    const mw = new PublicAuthMiddleware({} as any, oauth as any);
    const headers: Record<string, string> = {};
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      setHeader(k: string, v: string) { headers[k] = v; return this; },
      json(b: unknown) { this.body = b; return this; },
    };
    const req: any = {
      headers: { authorization: 'Bearer pos_abc' },
      method,
      originalUrl: url,
      url,
    };
    const next = jest.fn();
    await mw.use(req, res, next);
    return { res, req, next, headers };
  };

  const grant = (scopes?: string[]) => ({
    organization: org,
    membership: { role: 'ADMIN' },
    ...(scopes ? { scopes } : {}),
  });

  it('refuses a write made with a read-only token, directly against the API', async () => {
    const { res, next, headers } = await run(grant(['posts:read']), 'POST', '/public/v1/posts');
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: 'insufficient_scope', scope: 'posts:write' });
    expect(headers['WWW-Authenticate']).toContain('insufficient_scope');
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses channel administration without channels:write, whatever the casing', async () => {
    for (const url of [
      '/public/v1/integrations/c1/disable',
      '/public/v1/INTEGRATIONS/c1/disable',
      '/public/v1/social/x',
    ]) {
      const method = url.includes('social') ? 'GET' : 'POST';
      const { res, next } = await run(grant(['posts:read', 'posts:write']), method, url);
      expect(res.statusCode).toBe(403);
      expect(res.body.scope).toBe('channels:write');
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('lets a sufficient token through and exposes the member role', async () => {
    const { req, next, res } = await run(
      grant(['posts:read', 'posts:write', 'channels:write']),
      'POST',
      '/public/v1/integrations/c1/disable'
    );
    expect(res.statusCode).toBe(200);
    expect(next).toHaveBeenCalled();
    expect(req.org.users[0].role).toBe('ADMIN');
  });

  it('lets a posts:read MCP token reach the policy dry run, and nothing under policies:read', async () => {
    const dry = await run(grant(['posts:read']), 'POST', '/public/v1/policies/evaluate');
    expect(dry.res.statusCode).toBe(200);
    expect(dry.next).toHaveBeenCalled();
    expect(dry.req.publicApiScopes).toContain('posts:read');
    expect(dry.req.publicApiScopes).not.toContain('policies:read');

    // The middleware lets a GET through (posts:read); the route scope guard then refuses it.
    const list = await run(grant(['posts:read']), 'GET', '/public/v1/policies');
    expect(list.next).toHaveBeenCalled();
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['policies:read']) } as any;
    const guard = new PublicApiScopeGuard(reflector);
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => list.req }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    };
    let thrown: any;
    try {
      guard.canActivate(ctx);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect(thrown.getStatus()).toBe(403);
    expect(thrown.getResponse()).toMatchObject({ requiredScopes: ['policies:read'] });
  });

  it('keeps a write-only token (no posts:read) out of the policy dry run', async () => {
    const { res, next } = await run(grant(['posts:write']), 'POST', '/public/v1/policies/evaluate');
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: 'insufficient_scope', scope: 'posts:read' });
    expect(next).not.toHaveBeenCalled();
  });

  it('does not restrict tokens that carry no scope list (legacy OAuth apps)', async () => {
    const { next } = await run(grant(), 'POST', '/public/v1/posts');
    expect(next).toHaveBeenCalled();
  });
});
