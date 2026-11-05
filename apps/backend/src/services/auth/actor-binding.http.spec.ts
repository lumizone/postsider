import { Body, Controller, Get, Injectable, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicAuthMiddleware } from './public.auth.middleware';
import { currentActor } from '@postsider/nestjs-libraries/actor/actor-context';

/**
 * Proves the AsyncLocalStorage context set in the middleware survives into the
 * real Nest handler and across awaits in a service it calls, over real HTTP.
 */
// Barrier: when armed for N, each caller waits until N callers have arrived,
// so N requests are provably inside their contexts at the same time.
let barrierSize = 0;
let arrived = 0;
let release: (() => void) | null = null;
let gate: Promise<void> = Promise.resolve();
const armBarrier = (n: number) => {
  barrierSize = n;
  arrived = 0;
  gate = new Promise<void>((r) => (release = r));
};
const reachBarrier = async () => {
  if (!barrierSize) return;
  if (++arrived >= barrierSize) release!();
  await gate;
};

@Injectable()
class ProbeService {
  async actorAfterAwait(delayMs: number) {
    await new Promise((r) => setTimeout(r, delayMs));
    await reachBarrier();
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

  @Post()
  async post(@Body() _body: unknown) {
    await new Promise((r) => setTimeout(r, 1));
    return { handler: currentActor(), service: await this._probe.actorAfterAwait(1) };
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

  it('isolates two requests that are inside their contexts at the same time', async () => {
    armBarrier(2);
    try {
      const [a, b] = await Promise.all([get('key-a'), get('key-b')]);
      expect(arrived).toBe(2);
      expect(a.body.handler).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
      expect(a.body.service).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
      expect(b.body.handler).toEqual({ type: 'API_KEY', apiKeyId: 'k2' });
      expect(b.body.service).toEqual({ type: 'API_KEY', apiKeyId: 'k2' });
    } finally {
      barrierSize = 0;
    }
  });

  it('ignores spoofed actor fields in a POST body and header', async () => {
    const res = await fetch(base, {
      method: 'POST',
      headers: {
        authorization: 'key-a',
        'content-type': 'application/json',
        'x-postsider-agent': 'admin',
      },
      body: JSON.stringify({
        creationMethod: 'WEB',
        createdByType: 'USER',
        actor: { type: 'USER', userId: 'victim' },
      }),
    });
    const body = await res.json();
    expect(body.handler).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
    expect(body.service).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
  });
});
