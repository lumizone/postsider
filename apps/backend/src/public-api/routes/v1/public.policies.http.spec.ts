jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import 'reflect-metadata';
import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicPoliciesController } from './public.policies.controller';
import { PolicyRulesService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-rules.service';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { validateConditionParams } from '@postsider/nestjs-libraries/policies/policy-params';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';
import type { PostActor } from '@postsider/nestjs-libraries/actor/post-actor';

const publicRule = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'No links',
  enabled: true,
  priority: 100,
  appliesToActorTypes: [],
  appliesToApiKeyIds: [],
  appliesToIntegrationIds: [],
  appliesToProviders: [],
  condition: 'CONTAINS_LINK',
  conditionParams: {},
  effect: 'BLOCK',
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
  ...over,
});

describe('policy management API over HTTP', () => {
  let app: INestApplication;
  let base: string;
  let scopes: string[] = [];
  let actor: PostActor = { type: 'API_KEY', apiKeyId: 'k1' };

  const rules = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const audit = { logSecurityEvent: jest.fn(), logResourceEvent: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [PublicPoliciesController] })
      .useMocker((token) => {
        if (token === PolicyRulesService) return rules;
        if (token === AuditLogger) return audit;
        return {};
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', users: [{ role: 'SUPERADMIN' }] };
      req.publicApiScopes = scopes;
      runWithActor(actor, () => next());
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    scopes = ['policies:read', 'policies:write'];
    actor = { type: 'API_KEY', apiKeyId: 'k1' };
    audit.logSecurityEvent.mockResolvedValue(undefined);
    audit.logResourceEvent.mockResolvedValue(undefined);
  });

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  describe('scopes', () => {
    it.each([
      ['GET', '/policies'],
      ['GET', '/policies/r1'],
    ])('%s %s needs policies:read', async (method, path) => {
      scopes = ['policies:write', 'posts:read'];
      expect((await send(method, path)).status).toBe(403);
      expect(rules.list).not.toHaveBeenCalled();
      expect(rules.get).not.toHaveBeenCalled();
    });

    it.each([
      ['POST', '/policies', { name: 'n', condition: 'ALWAYS', effect: 'BLOCK' }],
      ['PUT', '/policies/r1', { name: 'n' }],
      ['DELETE', '/policies/r1', undefined],
    ])('%s %s needs policies:write', async (method, path, body) => {
      scopes = ['policies:read', 'posts:write'];
      expect((await send(method, path, body)).status).toBe(403);
      expect(rules.create).not.toHaveBeenCalled();
      expect(rules.update).not.toHaveBeenCalled();
      expect(rules.remove).not.toHaveBeenCalled();
      expect(audit.logSecurityEvent).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('lists the organization rules in the order the service returns them', async () => {
      rules.list.mockResolvedValue([publicRule({ id: 'a', priority: 1 }), publicRule({ id: 'b', priority: 5 })]);
      const res = await send('GET', '/policies?organizationId=org-evil');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.policies.map((p: any) => p.id)).toEqual(['a', 'b']);
      expect(rules.list).toHaveBeenCalledWith('org-1');
    });

    it('gets one rule scoped to the organization', async () => {
      rules.get.mockResolvedValue(publicRule());
      const res = await send('GET', '/policies/r1?organizationId=org-evil');
      expect(res.status).toBe(200);
      expect(rules.get).toHaveBeenCalledWith('org-1', 'r1');
    });

    it('answers 404 for a foreign id', async () => {
      rules.get.mockRejectedValue(new NotFoundException({ msg: 'Policy rule not found' }));
      expect((await send('GET', '/policies/other-org-rule')).status).toBe(404);
    });

    it('returns exactly what the service returns, with no organization or deletion fields', async () => {
      rules.get.mockResolvedValue(publicRule());
      const json = await (await send('GET', '/policies/r1')).json();
      expect(json).toEqual(publicRule());
      expect(json).not.toHaveProperty('organizationId');
      expect(json).not.toHaveProperty('deletedAt');
    });

    it('returns rules in the order the service gives (repository orders by priority)', async () => {
      rules.list.mockResolvedValue([publicRule({ id: 'a', priority: 1 }), publicRule({ id: 'b', priority: 1 }), publicRule({ id: 'c', priority: 7 })]);
      const json = await (await send('GET', '/policies')).json();
      expect(json.policies.map((p: any) => [p.id, p.priority])).toEqual([['a', 1], ['b', 1], ['c', 7]]);
    });

  });

  describe('create', () => {
    const body = {
      name: 'Secret',
      condition: 'CONTAINS_WORDS',
      conditionParams: { words: ['topsecretword'] },
      effect: 'BLOCK',
    };

    it('creates with 201, passes org.id and ignores a body organizationId', async () => {
      rules.create.mockResolvedValue(publicRule({ id: 'new', name: 'Secret' }));
      const res = await send('POST', '/policies', { ...body, organizationId: 'org-evil', id: 'x', deletedAt: null });
      expect(res.status).toBe(201);
      const [orgId, dto] = rules.create.mock.calls[0];
      expect(orgId).toBe('org-1');
      expect(dto).not.toHaveProperty('organizationId');
      expect(dto).not.toHaveProperty('id');
      expect(dto).not.toHaveProperty('deletedAt');
      expect(dto.name).toBe('Secret');
    });

    it('audits policy.create with only policyId and name', async () => {
      rules.create.mockResolvedValue(publicRule({ id: 'new', name: 'Secret' }));
      await send('POST', '/policies', body);
      expect(audit.logSecurityEvent).toHaveBeenCalledTimes(1);
      const [orgId, op, actorId, input] = audit.logSecurityEvent.mock.calls[0];
      expect(orgId).toBe('org-1');
      expect(op).toBe('policy.create');
      expect(actorId).toBeNull();
      expect(input).toEqual({ policyId: 'new', name: 'Secret' });
      expect(JSON.stringify(audit.logSecurityEvent.mock.calls[0])).not.toContain('topsecretword');
    });

    it('also writes a readable policy.changed resource event with the key actor, no conditionParams', async () => {
      rules.create.mockResolvedValue(publicRule({ id: 'new', name: 'Secret', enabled: true, effect: 'BLOCK' }));
      await send('POST', '/policies', body);
      expect(audit.logResourceEvent).toHaveBeenCalledWith({
        organizationId: 'org-1',
        event: 'policy.changed',
        targetType: 'organization',
        targetId: 'org-1',
        metadata: { operation: 'policy.create', policyId: 'new', name: 'Secret', enabled: true, effect: 'BLOCK' },
      });
      expect(JSON.stringify(audit.logResourceEvent.mock.calls)).not.toContain('topsecretword');
    });

    it('does not fail the request when auditing throws', async () => {
      rules.create.mockResolvedValue(publicRule());
      audit.logSecurityEvent.mockRejectedValue(new Error('db down'));
      audit.logResourceEvent.mockRejectedValue(new Error('db down'));
      expect((await send('POST', '/policies', body)).status).toBe(201);
    });

    it.each([
      ['array element', { appliesToActorTypes: [null] }],
      ['channel id element', { appliesToIntegrationIds: [null] }],
    ])('does not accept a null %s as a valid rule', async (_n, extra) => {
      rules.create.mockImplementation(async () => {
        throw new Error('service must not be reached with invalid input');
      });
      const res = await send('POST', '/policies', { ...body, ...extra });
      expect(res.status).toBeLessThan(500);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a null conditionParams word in the real params validator the service uses', () => {
      const r = validateConditionParams('CONTAINS_WORDS' as never, { words: [null] });
      expect(r.ok).toBe(false);
    });

    it('uses the user id of a USER actor and of an OAuth client grant', async () => {
      rules.create.mockResolvedValue(publicRule());
      actor = { type: 'USER', userId: 'u1' };
      await send('POST', '/policies', body);
      actor = { type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u2' };
      await send('POST', '/policies', body);
      actor = { type: 'OAUTH_CLIENT', oauthClientId: 'c1' };
      await send('POST', '/policies', body);
      expect(audit.logSecurityEvent.mock.calls.map((c) => c[2])).toEqual(['u1', 'u2', null]);
    });

    it('rejects an invalid body with 400 and writes nothing', async () => {
      const res = await send('POST', '/policies', { name: '', condition: 'NOPE', effect: 'BLOCK' });
      expect(res.status).toBe(400);
      expect(rules.create).not.toHaveBeenCalled();
      expect(audit.logSecurityEvent).not.toHaveBeenCalled();
    });

    it('rejects null optional fields with 400', async () => {
      const res = await send('POST', '/policies', { ...body, priority: null });
      expect(res.status).toBe(400);
      expect(rules.create).not.toHaveBeenCalled();
    });

    it('surfaces the policy_limit_reached 400 and does not audit', async () => {
      const { BadRequestException } = jest.requireActual('@nestjs/common');
      rules.create.mockRejectedValue(
        new BadRequestException({ error: 'policy_limit_reached', msg: 'limit' })
      );
      const res = await send('POST', '/policies', body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain('policy_limit_reached');
      expect(audit.logSecurityEvent).not.toHaveBeenCalled();
    });

  });

  describe('update', () => {
    it('updates scoped to the organization and audits policyId and name only', async () => {
      rules.update.mockResolvedValue(publicRule({ id: 'r1', name: 'Renamed' }));
      const res = await send('PUT', '/policies/r1', {
        name: 'Renamed',
        conditionParams: { words: ['topsecretword'] },
        organizationId: 'org-evil',
      });
      expect(res.status).toBe(200);
      const [orgId, id, dto] = rules.update.mock.calls[0];
      expect([orgId, id]).toEqual(['org-1', 'r1']);
      expect(dto).not.toHaveProperty('organizationId');
      expect(audit.logSecurityEvent).toHaveBeenCalledWith('org-1', 'policy.update', null, {
        policyId: 'r1',
        name: 'Renamed',
      });
      expect(audit.logResourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'policy.changed',
          targetType: 'organization',
          targetId: 'org-1',
          metadata: expect.objectContaining({
            operation: 'policy.update',
            policyId: 'r1',
            name: 'Renamed',
            changed: 'name,conditionParams',
          }),
        })
      );
      expect(JSON.stringify(audit.logResourceEvent.mock.calls)).not.toContain('topsecretword');
      expect(JSON.stringify(audit.logSecurityEvent.mock.calls[0])).not.toContain('topsecretword');
    });

    it('answers 404 for a foreign id without auditing', async () => {
      rules.update.mockRejectedValue(new NotFoundException({ msg: 'Policy rule not found' }));
      expect((await send('PUT', '/policies/foreign', { name: 'x' })).status).toBe(404);
      expect(audit.logSecurityEvent).not.toHaveBeenCalled();
    });

    it('rejects null fields with 400', async () => {
      const res = await send('PUT', '/policies/r1', { enabled: null });
      expect(res.status).toBe(400);
      expect(rules.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes scoped to the organization and audits policyId and name', async () => {
      rules.get.mockResolvedValue(publicRule({ name: 'Gone' }));
      rules.remove.mockResolvedValue({ id: 'r1', deleted: true });
      const res = await send('DELETE', '/policies/r1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 'r1', deleted: true });
      expect(rules.remove).toHaveBeenCalledWith('org-1', 'r1');
      expect(audit.logSecurityEvent).toHaveBeenCalledWith('org-1', 'policy.delete', null, {
        policyId: 'r1',
        name: 'Gone',
      });
      expect(audit.logResourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'policy.changed',
          metadata: expect.objectContaining({ operation: 'policy.delete', policyId: 'r1', name: 'Gone' }),
        })
      );
    });

    it('answers 404 for a foreign id without deleting or auditing', async () => {
      rules.get.mockRejectedValue(new NotFoundException({ msg: 'Policy rule not found' }));
      expect((await send('DELETE', '/policies/foreign')).status).toBe(404);
      expect(rules.remove).not.toHaveBeenCalled();
      expect(audit.logSecurityEvent).not.toHaveBeenCalled();
    });
  });
});
