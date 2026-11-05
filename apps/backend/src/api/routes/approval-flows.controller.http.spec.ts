jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import 'reflect-metadata';
import { ConflictException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { ApprovalFlowsController } from './approval-flows.controller';
import { ApprovalFlowService } from '@postsider/nestjs-libraries/database/prisma/approval/approval-flow.service';
import {
  AuthorizationActions,
  Sections,
} from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { CHECK_POLICIES_KEY } from '@postsider/backend/services/auth/permissions/permissions.ability';

describe('ApprovalFlowsController (dashboard)', () => {
  let app: INestApplication;
  let base: string;
  let role = 'ADMIN';
  const flows = { list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ApprovalFlowsController] })
      .useMocker((token) => (token === ApprovalFlowService ? flows : {}))
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', users: [{ role }] };
      req.user = { id: 'user-9' };
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/approval-flows`;
  });
  afterAll(async () => app.close());

  const flow = (over: Record<string, unknown> = {}) => ({
    id: 'f1',
    name: 'Flow',
    isDefault: false,
    preventSelfApproval: true,
    requireDistinctApprovers: true,
    stages: [{ position: 1, name: 'A', minRole: 'ADMIN', approverUserIds: [], allowAutomation: false, allowGuest: false }],
    ...over,
  });
  const validBody = (over: Record<string, unknown> = {}) => ({
    name: 'Flow',
    stages: [{ name: 'A', minRole: 'ADMIN' }],
    ...over,
  });
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeEach(() => {
    jest.resetAllMocks();
    role = 'ADMIN';
  });

  it('every handler carries the admin policy check', () => {
    for (const name of ['list', 'get', 'create', 'update', 'remove'] as const) {
      expect(Reflect.getMetadata(CHECK_POLICIES_KEY, ApprovalFlowsController.prototype[name])).toEqual([
        [AuthorizationActions.Create, Sections.ADMIN],
      ]);
    }
  });

  it('a USER role is refused with 403 on every route and nothing is touched', async () => {
    role = 'USER';
    const calls = [
      send('GET', ''),
      send('GET', '/f1'),
      send('POST', '', validBody()),
      send('PUT', '/f1', { name: 'x' }),
      send('DELETE', '/f1'),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    for (const fn of Object.values(flows)) expect(fn).not.toHaveBeenCalled();
  });

  it('SUPERADMIN is allowed', async () => {
    role = 'SUPERADMIN';
    flows.list.mockResolvedValue([]);
    expect((await send('GET', '')).status).toBe(200);
  });

  it('GET / lists flows of the session organization, no organizationId in the body', async () => {
    flows.list.mockResolvedValue([flow()]);
    const res = await send('GET', '?organizationId=org-evil');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ flows: [flow()] });
    expect(JSON.stringify(json)).not.toContain('organizationId');
    expect(flows.list).toHaveBeenCalledWith('org-1');
  });

  it('GET /:id is scoped to the session organization and a foreign id is 404', async () => {
    flows.get.mockRejectedValue(new NotFoundException({ error: 'approval_flow_not_found' }));
    expect((await send('GET', '/foreign')).status).toBe(404);
    expect(flows.get).toHaveBeenCalledWith('org-1', 'foreign');
  });

  it('POST picks known fields only: organizationId, id, deletedAt, flowId and position are dropped', async () => {
    flows.create.mockResolvedValue(flow());
    const res = await send(
      'POST',
      '',
      validBody({
        organizationId: 'org-evil',
        id: 'evil',
        deletedAt: '2020-01-01',
        stages: [{ name: 'A', minRole: 'ADMIN', flowId: 'evil', id: 'evil', position: 7 }],
      })
    );
    expect(res.status).toBe(201);
    expect(flows.create).toHaveBeenCalledWith('org-1', { name: 'Flow', stages: [{ name: 'A', minRole: 'ADMIN' }] });
  });

  it('POST validates the body (0 stages, USER role) with 400', async () => {
    expect((await send('POST', '', validBody({ stages: [] }))).status).toBe(400);
    expect((await send('POST', '', validBody({ stages: [{ name: 'A', minRole: 'USER' }] }))).status).toBe(400);
    expect(flows.create).not.toHaveBeenCalled();
  });

  it('PUT passes only supplied known fields', async () => {
    flows.update.mockResolvedValue(flow());
    const res = await send('PUT', '/f1', { isDefault: true, organizationId: 'org-evil' });
    expect(res.status).toBe(200);
    expect(flows.update).toHaveBeenCalledWith('org-1', 'f1', { isDefault: true });
  });

  it('PUT rejects null fields', async () => {
    expect((await send('PUT', '/f1', { isDefault: null })).status).toBe(400);
    expect(flows.update).not.toHaveBeenCalled();
  });

  it('DELETE archives and answers 409 flow_in_use with the error code', async () => {
    flows.archive.mockResolvedValueOnce({ id: 'f1', archived: true });
    const ok = await send('DELETE', '/f1');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ id: 'f1', archived: true });
    flows.archive.mockRejectedValueOnce(new ConflictException({ error: 'flow_in_use', msg: 'in use' }));
    const conflict = await send('DELETE', '/f1');
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual(expect.objectContaining({ error: 'flow_in_use' }));
    expect(flows.archive).toHaveBeenLastCalledWith('org-1', 'f1');
  });
});
