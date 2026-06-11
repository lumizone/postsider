import fc from 'fast-check';
import { Capability } from '@prisma/client';
import {
  AgentTokenService,
  AGENT_TOKEN_PREFIX,
} from '@postsider/nestjs-libraries/database/prisma/agent-tokens/agent-token.service';
import { AgentTokenRepository } from '@postsider/nestjs-libraries/database/prisma/agent-tokens/agent-token.repository';

const CAPABILITIES: Capability[] = ['PUBLISH', 'SOURCE', 'ANALYTICS', 'SCHEDULE'];

/**
 * In-memory fake of AgentTokenRepository — exercises issue/verify/authorize
 * without a database.
 */
class FakeAgentTokenRepository {
  private rows = new Map<string, any>();

  async create(orgId: string, name: string, tokenHash: string, scope: any) {
    const row = {
      id: 'tok_' + this.rows.size,
      organizationId: orgId,
      name,
      tokenHash,
      connectors: scope.connectors ?? [],
      capabilities: scope.capabilities ?? [],
      rateLimitPerMinute: scope.rateLimitPerMinute ?? 60,
      rateLimitPerDay: scope.rateLimitPerDay ?? 10000,
      expiresAt: scope.expiresAt ?? null,
      revokedAt: null as Date | null,
      lastUsedAt: null as Date | null,
      createdAt: new Date(),
      organization: { id: orgId },
    };
    this.rows.set(tokenHash, row);
    return row;
  }

  async findByHash(tokenHash: string) {
    return this.rows.get(tokenHash) ?? null;
  }

  async touchLastUsed() {
    /* no-op */
  }

  // Test helpers
  _revokeByHash(tokenHash: string) {
    const row = this.rows.get(tokenHash);
    if (row) row.revokedAt = new Date();
  }
  _expireByHash(tokenHash: string) {
    const row = this.rows.get(tokenHash);
    if (row) row.expiresAt = new Date(Date.now() - 1000);
  }
}

function makeService() {
  const repo = new FakeAgentTokenRepository();
  const service = new AgentTokenService(repo as unknown as AgentTokenRepository);
  return { repo, service };
}

const capsArb = fc.uniqueArray(fc.constantFrom(...CAPABILITIES));
const connectorsArb = fc.uniqueArray(
  fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /\S/.test(s))
);

describe('AgentTokenService', () => {
  it('Property 7: round-trips the token scope (issue → verify preserves scope)', async () => {
    await fc.assert(
      fc.asyncProperty(
        connectorsArb,
        capsArb,
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 100000 }),
        async (connectors, capabilities, perMin, perDay) => {
          const { service } = makeService();
          const issued = await service.issue('org1', 'test', {
            connectors,
            capabilities,
            rateLimitPerMinute: perMin,
            rateLimitPerDay: perDay,
          });

          expect(issued.token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);

          const verified = await service.verify(issued.token);
          expect(verified).not.toBeNull();
          expect(new Set(verified!.connectors)).toEqual(new Set(connectors));
          expect(new Set(verified!.capabilities)).toEqual(new Set(capabilities));
          expect(verified!.rateLimitPerMinute).toBe(perMin);
          expect(verified!.rateLimitPerDay).toBe(perDay);
        }
      )
    );
  });

  it('Property 8: authorization verdict is independent of revoked/expired ordering', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        async (revoke, expire) => {
          const { repo, service } = makeService();
          const issued = await service.issue('org1', 'test', {
            connectors: [],
            capabilities: ['PUBLISH'],
          });
          const hash = AgentTokenService.hashToken(issued.token);
          if (revoke) repo._revokeByHash(hash);
          if (expire) repo._expireByHash(hash);

          const verified = await service.verify(issued.token);
          // A token is valid only when neither revoked nor expired.
          if (revoke || expire) {
            expect(verified).toBeNull();
          } else {
            expect(verified).not.toBeNull();
          }
        }
      )
    );
  });

  it('authorize() denies capability not in scope', () => {
    const { service } = makeService();
    const denial = service.authorize(
      { connectors: [], capabilities: ['ANALYTICS'] },
      'x',
      'PUBLISH'
    );
    expect(denial).toBe('capability_not_allowed');
  });

  it('authorize() denies connector not in non-empty scope', () => {
    const { service } = makeService();
    const denial = service.authorize(
      { connectors: ['linkedin'], capabilities: ['PUBLISH'] },
      'x',
      'PUBLISH'
    );
    expect(denial).toBe('connector_not_authorized');
  });

  it('authorize() allows when capability present and connector scope empty', () => {
    const { service } = makeService();
    const denial = service.authorize(
      { connectors: [], capabilities: ['PUBLISH'] },
      'x',
      'PUBLISH'
    );
    expect(denial).toBeNull();
  });

  it('verify() rejects tokens without the agt_ prefix', async () => {
    const { service } = makeService();
    expect(await service.verify('pos_whatever')).toBeNull();
    expect(await service.verify('')).toBeNull();
  });
});
