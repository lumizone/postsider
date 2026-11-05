jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import 'reflect-metadata';
import { ConflictException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicApprovalFlowsController } from './public.approval-flows.controller';
import { ApprovalFlowService } from '@postsider/nestjs-libraries/database/prisma/approval/approval-flow.service';
import { PUBLIC_API_SCOPES_KEY } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { isPublicApiScope } from '@postsider/nestjs-libraries/services/public-api-scopes';

describe('PublicApprovalFlowsController', () => {
  let app: INestApplication;
  let base: string;
  let scopes: string[] = [];
  const flows = { list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [PublicApprovalFlowsController] })
      .useMocker((token) => (token === ApprovalFlowService ? flows : {}))
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', users: [{ role: 'SUPERADMIN' }] };
      req.publicApiScopes = scopes;
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    scopes = ['policies:read', 'policies:write'];
  });

  const flow = (over: Record<string, unknown> = {}) => ({
    id: 'f1',
    name: 'Flow',
    isDefault: false,
    preventSelfApproval: true,
    requireDistinctApprovers: true,
    stages: [{ position: 1, name: 'A', minRole: 'ADMIN', approverUserIds: [], allowAutomation: false, allowGuest: false }],
    ...over,
  });
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('route metadata: policies:read for reads, policies:write for writes, all known scopes', () => {
    const proto: any = PublicApprovalFlowsController.prototype;
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.list)).toEqual(['policies:read']);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.get)).toEqual(['policies:read']);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.create)).toEqual(['policies:write']);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.update)).toEqual(['policies:write']);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.remove)).toEqual(['policies:write']);
    for (const fn of [proto.list, proto.get, proto.create, proto.update, proto.remove]) {
      expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, fn).every(isPublicApiScope)).toBe(true);
    }
  });

  it.each([
    ['GET', '/approval-flows'],
    ['GET', '/approval-flows/f1'],
  ])('%s %s answers 403 without policies:read', async (method, path) => {
    scopes = ['policies:write', 'approvals:write', 'approvals:decide'];
    expect((await send(method, path)).status).toBe(403);
    expect(flows.list).not.toHaveBeenCalled();
    expect(flows.get).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', '/approval-flows', { name: 'n', stages: [{ name: 'A', minRole: 'ADMIN' }] }],
    ['PUT', '/approval-flows/f1', { name: 'n' }],
    ['DELETE', '/approval-flows/f1', undefined],
  ])('%s %s answers 403 without policies:write (approvals:decide cannot edit flows)', async (method, path, body) => {
    scopes = ['policies:read', 'approvals:decide', 'approvals:write'];
    expect((await send(method, path, body)).status).toBe(403);
    expect(flows.create).not.toHaveBeenCalled();
    expect(flows.update).not.toHaveBeenCalled();
    expect(flows.archive).not.toHaveBeenCalled();
  });

  it('lists flows of the key organization and ignores an organizationId in the query', async () => {
    flows.list.mockResolvedValue([flow()]);
    const res = await send('GET', '/approval-flows?organizationId=org-evil');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ flows: [flow()] });
    expect(JSON.stringify(json)).not.toContain('organizationId');
    expect(JSON.stringify(json)).not.toContain('deletedAt');
    expect(flows.list).toHaveBeenCalledWith('org-1');
  });

  it('gets one flow scoped to the organization and answers 404 for a foreign id', async () => {
    flows.get.mockRejectedValue(new NotFoundException({ error: 'approval_flow_not_found' }));
    expect((await send('GET', '/approval-flows/foreign')).status).toBe(404);
    expect(flows.get).toHaveBeenCalledWith('org-1', 'foreign');
  });

  it('POST picks known fields only', async () => {
    flows.create.mockResolvedValue(flow());
    const res = await send('POST', '/approval-flows', {
      name: 'Flow',
      organizationId: 'org-evil',
      deletedAt: 'x',
      stages: [{ name: 'A', minRole: 'ADMIN', flowId: 'evil', position: 4 }],
    });
    expect(res.status).toBe(201);
    expect(flows.create).toHaveBeenCalledWith('org-1', { name: 'Flow', stages: [{ name: 'A', minRole: 'ADMIN' }] });
  });

  it('POST answers 400 for an invalid body before the service is reached', async () => {
    const res = await send('POST', '/approval-flows', { name: 'Flow', stages: [] });
    expect(res.status).toBe(400);
    expect(flows.create).not.toHaveBeenCalled();
  });

  it('PUT passes only supplied known fields', async () => {
    flows.update.mockResolvedValue(flow());
    await send('PUT', '/approval-flows/f1', { name: 'N', id: 'evil', organizationId: 'org-evil' });
    expect(flows.update).toHaveBeenCalledWith('org-1', 'f1', { name: 'N' });
  });

  it('DELETE answers 409 with the flow_in_use body', async () => {
    flows.archive.mockRejectedValue(new ConflictException({ error: 'flow_in_use', msg: 'in use' }));
    const res = await send('DELETE', '/approval-flows/f1');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(expect.objectContaining({ error: 'flow_in_use' }));
  });

  it('DELETE returns the archived marker', async () => {
    flows.archive.mockResolvedValue({ id: 'f1', archived: true });
    const res = await send('DELETE', '/approval-flows/f1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'f1', archived: true });
    expect(flows.archive).toHaveBeenCalledWith('org-1', 'f1');
  });
});
