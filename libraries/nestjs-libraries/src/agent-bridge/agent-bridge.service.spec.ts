import fc from 'fast-check';
import { Capability } from '@prisma/client';
import { AgentBridgeService } from '@postsider/nestjs-libraries/agent-bridge/agent-bridge.service';
import { AgentTokenService } from '@postsider/nestjs-libraries/database/prisma/agent-tokens/agent-token.service';

// In-memory Redis stub used by idempotency helpers (ioRedis is a MockRedis
// without a REDIS_URL, but we exercise the helper logic directly here).
const redisStore = new Map<string, string>();
jest.mock('@postsider/nestjs-libraries/redis/redis.service', () => {
  return {
    get ioRedis() {
      return {
        get: async (k: string) => redisStore.get(k) ?? null,
        set: async (k: string, v: string) => {
          redisStore.set(k, v);
          return 'OK';
        },
      };
    },
  };
});

function makeService() {
  const auditEntries: any[] = [];
  const auditLogger = {
    log: async (e: any) => {
      auditEntries.push(e);
    },
  };
  const rateLimiter = {
    consume: async () => ({ allowed: true }),
  };
  const agentTokenService = new AgentTokenService({} as any);
  const service = new AgentBridgeService(
    {} as any, // catalog
    {} as any, // integrationService
    auditLogger as any,
    rateLimiter as any,
    agentTokenService
  );
  return { service, auditEntries };
}

describe('AgentBridgeService', () => {
  it('Property 6: idempotency replay returns the same publication id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        async (key, publicationId) => {
          redisStore.clear();
          const { service } = makeService();
          const orgId = 'org1';
          // First call: nothing stored yet.
          expect(await service.lookupIdempotent(orgId, key)).toBeNull();
          await service.rememberIdempotent(orgId, key, publicationId);
          // Replay returns the stored id (no duplicate created).
          expect(await service.lookupIdempotent(orgId, key)).toBe(publicationId);
        }
      )
    );
  });

  it('no idempotency key means no replay lookup', async () => {
    const { service } = makeService();
    expect(await service.lookupIdempotent('org1', undefined)).toBeNull();
  });

  it('Property 5: a denied guard writes exactly one audit entry with the correlation id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Capability>('PUBLISH', 'SOURCE', 'ANALYTICS', 'SCHEDULE'),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (capability, correlationId) => {
          const { service, auditEntries } = makeService();
          auditEntries.length = 0;
          const token = {
            id: 'tok1',
            organizationId: 'org1',
            connectors: ['linkedin'],
            capabilities: [] as Capability[], // grants nothing → denial
            rateLimitPerMinute: 60,
            rateLimitPerDay: 1000,
            organization: {},
          };
          const err = await service.guard(
            token as any,
            { id: 'org1' } as any,
            'publishPost',
            capability,
            'x',
            correlationId
          );
          expect(err).not.toBeNull();
          // exactly one audit entry, correlated.
          const correlated = auditEntries.filter(
            (e) => e.correlationId === correlationId
          );
          expect(correlated).toHaveLength(1);
          expect(correlated[0].status).toBe('capability_not_allowed');
        }
      )
    );
  });

  it('guard allows when scope and rate limit pass (no denial)', async () => {
    const { service, auditEntries } = makeService();
    auditEntries.length = 0;
    const token = {
      id: 'tok1',
      organizationId: 'org1',
      connectors: [] as string[],
      capabilities: ['PUBLISH'] as Capability[],
      rateLimitPerMinute: 60,
      rateLimitPerDay: 1000,
      organization: {},
    };
    const err = await service.guard(
      token as any,
      { id: 'org1' } as any,
      'publishPost',
      'PUBLISH',
      'linkedin',
      'corr-1'
    );
    expect(err).toBeNull();
  });
});
