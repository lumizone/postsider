jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { INestApplication, NotFoundException, BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PoliciesController } from './policies.controller';
import { PolicyRulesService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-rules.service';
import { PolicyEvaluationService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-evaluation.service';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthorizationActions, Sections } from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { CHECK_POLICIES_KEY } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';

describe('PoliciesController (dashboard)', () => {
  let app: INestApplication;
  let base: string;
  let role = 'ADMIN';
  const rules = { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn(), get: jest.fn() };
  const evaluation = {
    targetsFromDraftBody: jest.fn(),
    evaluateTargets: jest.fn(),
    recordOutcome: jest.fn(),
  };
  const audit = { logSecurityEvent: jest.fn(), logResourceEvent: jest.fn() };
  const orgs = { listApiKeys: jest.fn() };
  const approvalRouter = { route: jest.fn() };

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [PolicyRulesService, rules],
      [PolicyEvaluationService, evaluation],
      [AuditLogger, audit],
      [OrganizationService, orgs],
    ]);
    const moduleRef = await Test.createTestingModule({ controllers: [PoliciesController] })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', users: [{ role }] };
      req.user = { id: 'user-9' };
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/policies`;
  });
  afterAll(async () => app.close());

  const ruleRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    name: 'No links',
    enabled: true,
    effect: 'BLOCK',
    condition: 'CONTAINS_LINK',
    conditionParams: {},
    ...over,
  });
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const evalBody = (over: Record<string, unknown> = {}) => ({
    type: 'schedule',
    date: '2030-01-01T00:00:00.000Z',
    posts: [{ integration: { id: 'c1' }, value: [{ content: 'hi' }] }],
    ...over,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    role = 'ADMIN';
    audit.logSecurityEvent.mockResolvedValue(undefined);
    audit.logResourceEvent.mockResolvedValue(undefined);
    evaluation.targetsFromDraftBody.mockResolvedValue([{ id: 't' }]);
    evaluation.evaluateTargets.mockResolvedValue({
      effect: 'ALLOW',
      matched: [],
      channels: [{ integrationId: 'c1', effect: 'ALLOW', extra: 'x' }],
    });
    orgs.listApiKeys.mockResolvedValue([]);
  });

  it('every handler carries the admin policy check', () => {
    for (const name of ['list', 'create', 'update', 'remove', 'evaluate'] as const) {
      expect(Reflect.getMetadata(CHECK_POLICIES_KEY, PoliciesController.prototype[name])).toEqual([
        [AuthorizationActions.Create, Sections.ADMIN],
      ]);
    }
  });

  it('a non-admin role is refused on every route and nothing is touched', async () => {
    role = 'USER';
    const calls = [
      send('GET', ''),
      send('POST', '', { name: 'a', condition: 'ALWAYS', effect: 'BLOCK' }),
      send('PUT', '/r1', { name: 'b' }),
      send('DELETE', '/r1'),
      send('POST', '/evaluate', evalBody()),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    expect(rules.list).not.toHaveBeenCalled();
    expect(rules.create).not.toHaveBeenCalled();
    expect(rules.update).not.toHaveBeenCalled();
    expect(rules.remove).not.toHaveBeenCalled();
    expect(evaluation.targetsFromDraftBody).not.toHaveBeenCalled();
    expect(audit.logSecurityEvent).not.toHaveBeenCalled();
  });

  it('SUPERADMIN is allowed', async () => {
    role = 'SUPERADMIN';
    rules.list.mockResolvedValue([]);
    expect((await send('GET', '')).status).toBe(200);
  });

  it('GET / returns the public rules', async () => {
    rules.list.mockResolvedValue([ruleRow()]);
    const res = await send('GET', '');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ policies: [{ ...ruleRow(), displayName: 'No links' }] });
    expect(rules.list).toHaveBeenCalledWith('org-1');
  });

  it('list, create and update add a cleaned displayName and keep the raw name', async () => {
    const dirty = 'Evil\u202e\u200b\u0007 rule';
    rules.list.mockResolvedValue([ruleRow({ name: dirty })]);
    rules.create.mockResolvedValue(ruleRow({ name: dirty }));
    rules.update.mockResolvedValue(ruleRow({ name: dirty }));
    const listed = (await (await send('GET', '')).json()).policies[0];
    const created = await (await send('POST', '', { name: dirty, condition: 'ALWAYS', effect: 'BLOCK' })).json();
    const updated = await (await send('PUT', '/r1', { name: dirty })).json();
    for (const r of [listed, created, updated]) {
      expect(r.name).toBe(dirty);
      expect(r.displayName).toBe('Evil rule');
    }
  });

  it('POST / picks only known rule fields, audits and returns 201', async () => {
    rules.create.mockResolvedValue(ruleRow());
    const res = await send('POST', '', {
      name: 'No links',
      condition: 'CONTAINS_WORDS',
      conditionParams: { words: ['secret'] },
      effect: 'BLOCK',
      organizationId: 'evil',
      id: 'evil',
      deletedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
    expect(rules.create).toHaveBeenCalledWith('org-1', {
      name: 'No links',
      condition: 'CONTAINS_WORDS',
      conditionParams: { words: ['secret'] },
      effect: 'BLOCK',
    });
    expect(audit.logSecurityEvent).toHaveBeenCalledWith('org-1', 'policy.create', 'user-9', {
      ruleId: 'r1',
      name: 'No links',
    });
    const security = JSON.stringify(audit.logSecurityEvent.mock.calls);
    expect(security).not.toContain('secret');
    expect(security).not.toContain('conditionParams');
    const resource = audit.logResourceEvent.mock.calls[0][0];
    expect(resource).toMatchObject({
      organizationId: 'org-1',
      event: 'policy.changed',
      actor: { type: 'USER', userId: 'user-9' },
    });
    expect(JSON.stringify(resource)).not.toContain('secret');
  });

  it('POST / passes a service 400 (policy_limit_reached) through and audits nothing', async () => {
    rules.create.mockRejectedValue(new BadRequestException({ error: 'policy_limit_reached', msg: 'limit' }));
    const res = await send('POST', '', { name: 'a', condition: 'ALWAYS', effect: 'BLOCK' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('policy_limit_reached');
    expect(audit.logSecurityEvent).not.toHaveBeenCalled();
    expect(audit.logResourceEvent).not.toHaveBeenCalled();
  });

  it('PUT /:id rejects a null field with 400 and writes nothing', async () => {
    const res = await send('PUT', '/r1', { name: null });
    expect(res.status).toBe(400);
    expect(rules.update).not.toHaveBeenCalled();
  });

  it('PUT /:id accepts approvalFlowId null (clears the flow) and the view carries approvalFlowId', async () => {
    rules.update.mockResolvedValue(ruleRow({ effect: 'REQUIRE_APPROVAL', approvalFlowId: null }));
    const res = await send('PUT', '/r1', { approvalFlowId: null });
    expect(res.status).toBe(200);
    expect(rules.update).toHaveBeenCalledWith('org-1', 'r1', { approvalFlowId: null });
    expect(await res.json()).toMatchObject({ approvalFlowId: null });
  });

  it('PUT /:id passes a flow id through and still rejects null for other fields', async () => {
    rules.update.mockResolvedValue(ruleRow({ effect: 'REQUIRE_APPROVAL', approvalFlowId: 'f1' }));
    const ok = await send('PUT', '/r1', { approvalFlowId: 'f1' });
    expect(ok.status).toBe(200);
    expect(rules.update).toHaveBeenCalledWith('org-1', 'r1', { approvalFlowId: 'f1' });
    expect((await ok.json()).approvalFlowId).toBe('f1');
    rules.update.mockClear();
    expect((await send('PUT', '/r1', { effect: null })).status).toBe(400);
    expect(rules.update).not.toHaveBeenCalled();
  });

  it('POST / passes approvalFlowId to the service and rejects a 65 character id', async () => {
    rules.create.mockResolvedValue(ruleRow({ effect: 'REQUIRE_APPROVAL', approvalFlowId: 'f1' }));
    const res = await send('POST', '', { name: 'a', condition: 'ALWAYS', effect: 'REQUIRE_APPROVAL', approvalFlowId: 'f1' });
    expect(res.status).toBe(201);
    expect(rules.create.mock.calls[0][1]).toMatchObject({ approvalFlowId: 'f1' });
    const bad = await send('POST', '', { name: 'a', condition: 'ALWAYS', effect: 'REQUIRE_APPROVAL', approvalFlowId: 'x'.repeat(65) });
    expect(bad.status).toBe(400);
  });

  it('PUT /:id sends only known fields, audits changed field names only', async () => {
    rules.update.mockResolvedValue(ruleRow({ name: 'Renamed' }));
    const res = await send('PUT', '/r1', {
      name: 'Renamed',
      conditionParams: { words: ['hidden'] },
      organizationId: 'evil',
    });
    expect(res.status).toBe(200);
    expect(rules.update).toHaveBeenCalledWith('org-1', 'r1', {
      name: 'Renamed',
      conditionParams: { words: ['hidden'] },
    });
    expect(audit.logSecurityEvent).toHaveBeenCalledWith('org-1', 'policy.update', 'user-9', {
      ruleId: 'r1',
      name: 'Renamed',
    });
    const resource = audit.logResourceEvent.mock.calls[0][0];
    expect(resource.metadata.changed).toBe('name,conditionParams');
    expect(JSON.stringify(resource)).not.toContain('hidden');
  });

  it('PUT and DELETE of a foreign id answer 404 and audit nothing', async () => {
    rules.update.mockRejectedValue(new NotFoundException({ msg: 'Policy rule not found' }));
    rules.get.mockRejectedValue(new NotFoundException({ msg: 'Policy rule not found' }));
    expect((await send('PUT', '/other', { name: 'x' })).status).toBe(404);
    expect((await send('DELETE', '/other')).status).toBe(404);
    expect(rules.remove).not.toHaveBeenCalled();
    expect(audit.logSecurityEvent).not.toHaveBeenCalled();
  });

  it('DELETE /:id removes and audits policy.delete', async () => {
    rules.get.mockResolvedValue(ruleRow());
    rules.remove.mockResolvedValue({ id: 'r1', deleted: true });
    const res = await send('DELETE', '/r1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'r1', deleted: true });
    expect(rules.remove).toHaveBeenCalledWith('org-1', 'r1');
    expect(audit.logSecurityEvent).toHaveBeenCalledWith('org-1', 'policy.delete', 'user-9', {
      ruleId: 'r1',
      name: 'No links',
    });
  });

  it('evaluate uses the session USER as the default actor and shapes the response', async () => {
    evaluation.evaluateTargets.mockResolvedValue({
      effect: 'BLOCK',
      matched: [{ ruleId: 'r1', name: 'Bad\u202e name', effect: 'BLOCK' }],
      channels: [{ integrationId: 'c1', effect: 'BLOCK', extra: 'x' }],
    });
    const res = await send('POST', '/evaluate', evalBody());
    expect(res.status).toBe(200);
    expect(evaluation.targetsFromDraftBody).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ type: 'schedule' }),
      { type: 'USER', userId: 'user-9' }
    );
    expect(evaluation.evaluateTargets).toHaveBeenCalledWith('org-1', [{ id: 't' }], 'write');
    const json = await res.json();
    expect(json.effect).toBe('BLOCK');
    expect(json.matched[0].name).toBe('Bad name');
    expect(json.channels).toEqual([{ integrationId: 'c1', effect: 'BLOCK' }]);
    expect(json.key).toEqual({ allowed: true });
  });

  it('evaluate strips unknown body keys before evaluation', async () => {
    await send('POST', '/evaluate', evalBody({ organizationId: 'evil', shortLink: true }));
    const draft = evaluation.targetsFromDraftBody.mock.calls[0][1];
    expect(draft).not.toHaveProperty('organizationId');
    expect(draft).not.toHaveProperty('shortLink');
    expect(draft).not.toHaveProperty('asActor');
  });

  it('asActor API_KEY limited to DRAFT with type now reports key_action_not_allowed', async () => {
    orgs.listApiKeys.mockResolvedValue([{ id: 'k1', allowedActions: ['DRAFT'], allowedIntegrationIds: [] }]);
    const res = await send('POST', '/evaluate', evalBody({ type: 'now', date: undefined, asActor: { type: 'API_KEY', apiKeyId: 'k1' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).key).toEqual({ allowed: false, code: 'key_action_not_allowed' });
    expect(evaluation.targetsFromDraftBody.mock.calls[0][2]).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
  });

  it('asActor API_KEY reports key_channel_not_allowed', async () => {
    orgs.listApiKeys.mockResolvedValue([{ id: 'k1', allowedActions: [], allowedIntegrationIds: ['other'] }]);
    const res = await send('POST', '/evaluate', evalBody({ asActor: { type: 'API_KEY', apiKeyId: 'k1' } }));
    expect((await res.json()).key).toEqual({ allowed: false, code: 'key_channel_not_allowed' });
  });

  it('an apiKeyId of another organization is a 400 unknown_api_key', async () => {
    orgs.listApiKeys.mockResolvedValue([{ id: 'mine', allowedActions: [], allowedIntegrationIds: [] }]);
    const res = await send('POST', '/evaluate', evalBody({ asActor: { type: 'API_KEY', apiKeyId: 'theirs' } }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('unknown_api_key');
    expect(evaluation.targetsFromDraftBody).not.toHaveBeenCalled();
  });

  it('asActor API_KEY without id is the legacy key, OAUTH_CLIENT has a null client, SYSTEM is system', async () => {
    await send('POST', '/evaluate', evalBody({ asActor: { type: 'API_KEY' } }));
    await send('POST', '/evaluate', evalBody({ asActor: { type: 'OAUTH_CLIENT' } }));
    await send('POST', '/evaluate', evalBody({ asActor: { type: 'SYSTEM' } }));
    await send('POST', '/evaluate', evalBody({ asActor: { type: 'USER' } }));
    expect(evaluation.targetsFromDraftBody.mock.calls.map((c) => c[2])).toEqual([
      { type: 'API_KEY', apiKeyId: null },
      { type: 'OAUTH_CLIENT', oauthClientId: null },
      { type: 'SYSTEM' },
      { type: 'USER', userId: 'user-9' },
    ]);
    expect(orgs.listApiKeys).not.toHaveBeenCalled();
  });

  it('a foreign channel id is a 404 from the service', async () => {
    evaluation.targetsFromDraftBody.mockRejectedValue(new NotFoundException({ msg: 'Channel not found' }));
    expect((await send('POST', '/evaluate', evalBody())).status).toBe(404);
  });

  it('PolicyInputTooLargeError becomes 400 policy_input_too_large', async () => {
    evaluation.targetsFromDraftBody.mockRejectedValue(new PolicyInputTooLargeError());
    const res = await send('POST', '/evaluate', evalBody());
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('policy_input_too_large');
  });

  it('an invalid evaluate body (unknown actor type) is a 400', async () => {
    expect((await send('POST', '/evaluate', evalBody({ asActor: { type: 'ROBOT' } }))).status).toBe(400);
    expect((await send('POST', '/evaluate', evalBody({ asActor: { type: 'USER', apiKeyId: 'k' } }))).status).toBe(400);
  });

  it('evaluate writes nothing: no audit, no record, no approval route, no rule write', async () => {
    await send('POST', '/evaluate', evalBody());
    expect(audit.logSecurityEvent).not.toHaveBeenCalled();
    expect(audit.logResourceEvent).not.toHaveBeenCalled();
    expect(evaluation.recordOutcome).not.toHaveBeenCalled();
    expect(approvalRouter.route).not.toHaveBeenCalled();
    expect(rules.create).not.toHaveBeenCalled();
    expect(rules.update).not.toHaveBeenCalled();
    expect(rules.remove).not.toHaveBeenCalled();
  });
});
