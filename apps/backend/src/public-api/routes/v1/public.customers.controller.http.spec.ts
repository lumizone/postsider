jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicCustomersController } from './public.customers.controller';
import { PublicWorkspaceController } from './public.workspace.controller';
import { CustomerService } from '@postsider/nestjs-libraries/database/prisma/integrations/customer.service';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { PublicApiIdempotencyService } from '@postsider/nestjs-libraries/database/prisma/idempotency/public-api-idempotency.service';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { PUBLIC_API_SCOPES } from '@postsider/nestjs-libraries/services/public-api-scopes';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { PUBLIC_API_SCOPES_KEY } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';

describe('customers over HTTP', () => {
  let app: INestApplication;
  let base: string;
  let role = 'SUPERADMIN';
  let scopes: string[] = [...PUBLIC_API_SCOPES];

  const customers = {
    list: jest.fn(),
    create: jest.fn(),
    rename: jest.fn(),
    archive: jest.fn(),
    get: jest.fn(),
  };
  const idempotency = { claim: jest.fn(), complete: jest.fn(), release: jest.fn() };
  const integrations = {
    getIntegrationById: jest.fn(),
    updateOnCustomerName: jest.fn(),
    updateIntegrationGroup: jest.fn(),
  };

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [CustomerService, customers],
      [PublicApiIdempotencyService, idempotency],
      [IntegrationService, integrations],
    ]);
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicCustomersController, PublicWorkspaceController],
    })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', defaultTimezone: null, users: [{ role }] };
      req.publicApiScopes = scopes;
      runWithActor({ type: 'API_KEY', id: 'k1', apiKeyId: 'k1' } as any, () => next());
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    role = 'SUPERADMIN';
    scopes = [...PUBLIC_API_SCOPES];
    idempotency.claim.mockResolvedValue(null);
    integrations.getIntegrationById.mockResolvedValue({ id: 'ch1', deletedAt: null });
    integrations.updateOnCustomerName.mockResolvedValue({});
    integrations.updateIntegrationGroup.mockResolvedValue({});
  });

  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const cust = { id: 'c1', name: 'Acme', createdAt: new Date('2026-01-01'), channelCount: 1 };

  describe('scopes by metadata', () => {
    it.each([
      ['list', ['channels:read']],
      ['create', ['channels:write']],
      ['rename', ['channels:write']],
      ['archive', ['channels:write']],
    ])('%s requires %j', (name, expected) => {
      const handler = (PublicCustomersController.prototype as any)[name];
      expect(Reflect.hasMetadata(METHOD_METADATA, handler)).toBe(true);
      expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, handler)).toEqual(expected);
    });

    it('is guarded by the scope guard', () => {
      const guards = Reflect.getMetadata('__guards__', PublicCustomersController) ?? [];
      expect(guards).toContain(PublicApiScopeGuard);
    });
  });

  describe('GET /customers', () => {
    it('lists customers without leaking the organization id', async () => {
      customers.list.mockResolvedValue([{ ...cust, orgId: 'org-1' }]);
      const res = await send('GET', '/customers');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.customers).toEqual([
        { id: 'c1', name: 'Acme', channelCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      ]);
      expect(customers.list).toHaveBeenCalledWith('org-1');
    });

    it('is open to a USER role (read only)', async () => {
      role = 'USER';
      customers.list.mockResolvedValue([]);
      expect((await send('GET', '/customers')).status).toBe(200);
    });
  });

  describe('writes', () => {
    it('USER role gets 403 on every write and nothing is called', async () => {
      role = 'USER';
      expect((await send('POST', '/customers', { name: 'A' })).status).toBe(403);
      expect((await send('PUT', '/customers/c1', { name: 'A' })).status).toBe(403);
      expect((await send('POST', '/customers/c1/archive')).status).toBe(403);
      expect(customers.create).not.toHaveBeenCalled();
      expect(customers.rename).not.toHaveBeenCalled();
      expect(customers.archive).not.toHaveBeenCalled();
      expect(idempotency.claim).not.toHaveBeenCalled();
    });

    it('POST creates with 201, and answers 200 for an existing name', async () => {
      customers.create.mockResolvedValueOnce({ customer: cust, created: true });
      const created = await send('POST', '/customers', { name: ' Acme ' });
      expect(created.status).toBe(201);
      expect((await created.json()).id).toBe('c1');
      expect(customers.create).toHaveBeenCalledWith('org-1', 'Acme');

      customers.create.mockResolvedValueOnce({ customer: cust, created: false });
      const again = await send('POST', '/customers', { name: 'Acme' });
      expect(again.status).toBe(200);
    });

    it('POST rejects an invalid name with 400', async () => {
      expect((await send('POST', '/customers', { name: '' })).status).toBe(400);
      expect((await send('POST', '/customers', { name: 'a'.repeat(101) })).status).toBe(400);
      expect((await send('POST', '/customers', { name: 'a\u0001b' })).status).toBe(400);
      expect((await send('POST', '/customers', {})).status).toBe(400);
      expect(customers.create).not.toHaveBeenCalled();
    });

    it('POST uses the Idempotency-Key: replay returns the stored body, completion stores it', async () => {
      idempotency.claim.mockResolvedValueOnce({ kind: 'replay', response: { id: 'c1', name: 'Acme' } });
      const replay = await send('POST', '/customers', { name: 'Acme' }, { 'idempotency-key': 'k-1' });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ id: 'c1', name: 'Acme' });
      expect(customers.create).not.toHaveBeenCalled();

      idempotency.claim.mockResolvedValueOnce({ kind: 'new', id: 'claim-1' });
      customers.create.mockResolvedValueOnce({ customer: cust, created: true });
      const fresh = await send('POST', '/customers', { name: 'Acme' }, { 'idempotency-key': 'k-2' });
      expect(fresh.status).toBe(201);
      expect(idempotency.complete).toHaveBeenCalledWith('claim-1', expect.objectContaining({ id: 'c1' }));
    });

    it('POST releases the claim when the service fails', async () => {
      idempotency.claim.mockResolvedValueOnce({ kind: 'new', id: 'claim-9' });
      customers.create.mockRejectedValueOnce(
        Object.assign(new (require('@nestjs/common').BadRequestException)({ error: 'customer_limit_reached', msg: 'x' }))
      );
      const res = await send('POST', '/customers', { name: 'Acme' }, { 'idempotency-key': 'k-3' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('customer_limit_reached');
      expect(idempotency.release).toHaveBeenCalledWith('claim-9');
      expect(idempotency.complete).not.toHaveBeenCalled();
    });

    it('PUT renames', async () => {
      customers.rename.mockResolvedValue({ ...cust, name: 'New' });
      const res = await send('PUT', '/customers/c1', { name: 'New' });
      expect(res.status).toBe(200);
      expect((await res.json()).name).toBe('New');
      expect(customers.rename).toHaveBeenCalledWith('org-1', 'c1', 'New');
    });

    it('POST archive answers 200 with the detach count', async () => {
      customers.archive.mockResolvedValue({ id: 'c1', archived: true, detachedChannels: 2 });
      const res = await send('POST', '/customers/c1/archive');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 'c1', archived: true, detachedChannels: 2 });
    });
  });

  describe('PUT /integrations/:id/customer', () => {
    it('400 when both name and customerId are set', async () => {
      const res = await send('PUT', '/integrations/ch1/customer', { name: 'A', customerId: 'c1' });
      expect(res.status).toBe(400);
      expect(integrations.updateOnCustomerName).not.toHaveBeenCalled();
      expect(integrations.updateIntegrationGroup).not.toHaveBeenCalled();
    });

    it('404 for a foreign or archived customerId', async () => {
      customers.get.mockRejectedValue(new (require('@nestjs/common').NotFoundException)({ msg: 'Customer not found' }));
      const res = await send('PUT', '/integrations/ch1/customer', { customerId: 'foreign' });
      expect(res.status).toBe(404);
      expect(customers.get).toHaveBeenCalledWith('org-1', 'foreign');
      expect(integrations.updateIntegrationGroup).not.toHaveBeenCalled();
    });

    it('400 when customerId is not a string', async () => {
      const res = await send('PUT', '/integrations/ch1/customer', { customerId: { contains: '' } });
      expect(res.status).toBe(400);
    });

    it('assigns by customerId through updateIntegrationGroup', async () => {
      customers.get.mockResolvedValue(cust);
      const res = await send('PUT', '/integrations/ch1/customer', { customerId: 'c1' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 'ch1', customer: 'Acme', customerId: 'c1' });
      expect(integrations.updateIntegrationGroup).toHaveBeenCalledWith('org-1', 'ch1', 'c1');
    });

    it('customerId null unassigns', async () => {
      const res = await send('PUT', '/integrations/ch1/customer', { customerId: null });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 'ch1', customer: null, customerId: null });
      expect(integrations.updateIntegrationGroup).toHaveBeenCalledWith('org-1', 'ch1', '');
    });

    it('keeps the existing { name } behaviour', async () => {
      const res = await send('PUT', '/integrations/ch1/customer', { name: ' Acme ' });
      expect(await res.json()).toEqual({ id: 'ch1', customer: 'Acme' });
      expect(integrations.updateOnCustomerName).toHaveBeenCalledWith('org-1', 'ch1', 'Acme');
    });

    it('USER role still gets 403', async () => {
      role = 'USER';
      const res = await send('PUT', '/integrations/ch1/customer', { customerId: 'c1' });
      expect(res.status).toBe(403);
    });
  });
});
