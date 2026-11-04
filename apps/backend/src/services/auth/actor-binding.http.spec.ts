import { Controller, Get, Injectable, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicAuthMiddleware } from './public.auth.middleware';
import { currentActor } from '@postsider/nestjs-libraries/actor/actor-context';

/**
 * Proves the AsyncLocalStorage context set in the middleware survives into the
 * real Nest handler and across awaits in a service it calls, over real HTTP.
 */
@Injectable()
class ProbeService {
  async actorAfterAwait(delayMs: number) {
    await new Promise((r) => setTimeout(r, delayMs));
    await Promise.resolve();
    return currentActor();
  }
}

@Controller('probe')
class ProbeController {
  constructor(private _probe: ProbeService) {}

  @Get()
  async get() {
    await new Promise((r) => setTimeout(r, 1));
    const fromService = await this._probe.actorAfterAwait(5);
    return { handler: currentActor(), service: fromService };
  }
}

describe('Actor binding over HTTP', () => {
  let app: INestApplication;
  let base: string;

  const organizations = {
    resolvePublicApiCredential: jest.fn(async (key: string) => {
      // Make the first request finish last so two requests interleave.
      await new Promise((r) => setTimeout(r, key === 'key-a' ? 20 : 1));
      return {
        organization: { id: 'org-1', subscription: null },
        scopes: ['posts:read'],
        credentialType: 'api-key',
        apiKeyId: key === 'key-a' ? 'k1' : 'k2',
      };
    }),
  };
  const oauth = {
    getOrgByOAuthToken: jest.fn().mockResolvedValue({
      organization: { id: 'org-1', subscription: null },
      membership: { userId: 'u7', role: 'USER', disabled: false },
      scopes: ['posts:read'],
      mcpOAuthClientId: 'mc1',
      userId: 'u7',
    }),
  };

  beforeAll(async () => {
    delete process.env.POLAR_ACCESS_TOKEN;
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [ProbeService],
    }).compile();
    app = moduleRef.createNestApplication();
    const middleware = new PublicAuthMiddleware(organizations as any, oauth as any);
    app.use((req: any, res: any, next: any) => {
      middleware.use(req, res, next).catch(next);
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/probe`;
  });

  afterAll(async () => app.close());

  const get = async (authorization: string) => {
    const res = await fetch(base, { headers: { authorization } });
    return { status: res.status, body: await res.json() };
  };

  it('keeps the API key actor in the handler and across service awaits', async () => {
    const { status, body } = await get('key-a');
    expect(status).toBe(200);
    expect(body.handler).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
    expect(body.service).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
  });

  it('keeps the MCP OAuth actor with the authorizing user', async () => {
    const { body } = await get('Bearer pos_mcp');
    const expected = { type: 'OAUTH_CLIENT', oauthClientId: 'mc1', userId: 'u7' };
    expect(body.handler).toEqual(expected);
    expect(body.service).toEqual(expected);
  });

  it('isolates two concurrent requests with different keys', async () => {
    const [a, b] = await Promise.all([get('key-a'), get('key-b')]);
    expect(a.body.handler).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
    expect(a.body.service).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
    expect(b.body.handler).toEqual({ type: 'API_KEY', apiKeyId: 'k2' });
    expect(b.body.service).toEqual({ type: 'API_KEY', apiKeyId: 'k2' });
  });
});
