jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { BadRequestException, HttpException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { AgentActivityController } from './agent-activity.controller';
import { AgentActivityActionsService } from '@postsider/nestjs-libraries/database/prisma/agent-activity/agent-activity-actions.service';
import { AuthorizationActions, Sections } from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { AgentActivityService } from '@postsider/nestjs-libraries/database/prisma/agent-activity/agent-activity.service';
import { CHECK_POLICIES_KEY } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';

describe('AgentActivityController (dashboard reads)', () => {
  let app: INestApplication;
  let base: string;
  let role = 'USER';
  const actions = { bulkResolve: jest.fn(), retryFailed: jest.fn() };
  const service = { summary: jest.fn(), list: jest.fn(), filters: jest.fn(), detail: jest.fn() };

  beforeAll(async () => {
    const tokens = new Map<any, any>([[AgentActivityService, service], [AgentActivityActionsService, actions]]);
    const moduleRef = await Test.createTestingModule({ controllers: [AgentActivityController] })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', defaultTimezone: 'Europe/Warsaw', users: [{ role }] };
      req.user = { id: 'user-9' };
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/agent-activity`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    role = 'USER';
    service.summary.mockResolvedValue({ actionsToday: 3 });
    service.list.mockResolvedValue({ groups: [], nextCursor: null });
    service.filters.mockResolvedValue({ actors: [], agentNames: [], sources: [] });
  });

  it('summary passes the requested and the org default timezone and returns the body', async () => {
    const res = await fetch(`${base}/summary?timezone=Asia/Tokyo`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionsToday: 3 });
    expect(service.summary).toHaveBeenCalledWith('org-1', {
      timezone: 'Asia/Tokyo',
      orgDefaultTimezone: 'Europe/Warsaw',
    });
  });

  it('declares no policy check on any read handler (every member may read)', () => {
    for (const name of ['summary', 'list', 'filters'] as const) {
      expect(Reflect.getMetadata(CHECK_POLICIES_KEY, AgentActivityController.prototype[name])).toBeUndefined();
    }
  });

  it('allows a USER-role member on reads', async () => {
    role = 'USER';
    expect((await fetch(`${base}/summary`)).status).toBe(200);
    expect((await fetch(base)).status).toBe(200);
    expect((await fetch(`${base}/filters`)).status).toBe(200);
  });

  it('list passes parsed filters with defaults', async () => {
    const res = await fetch(`${base}?bucket=blocked&integrationIds=a,b&limit=10`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groups: [], nextCursor: null });
    expect(service.list).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        bucket: 'blocked',
        integrationIds: ['a', 'b'],
        limit: 10,
        scope: 'relevant',
      })
    );
  });

  it('list converts from and to to Date', async () => {
    await fetch(`${base}?from=2026-11-01T00:00:00.000Z&to=2026-11-02T00:00:00.000Z`);
    const q = service.list.mock.calls[0][1];
    expect(q.from).toEqual(new Date('2026-11-01T00:00:00.000Z'));
    expect(q.to).toEqual(new Date('2026-11-02T00:00:00.000Z'));
  });

  it.each([
    ['limit=0'],
    ['limit=51'],
    ['bucket=nope'],
    [`integrationIds=${Array.from({ length: 21 }, (_, i) => `i${i}`).join(',')}`],
    ['from=garbage'],
    ['from=2026-W01'],
    ['to=2026-123'],
    [`integrationIds=${'a'.repeat(101)}`],
  ])('rejects %s with 400 and does not call the service', async (qs) => {
    const res = await fetch(`${base}?${qs}`);
    expect(res.status).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('surfaces a service BadRequestException as 400', async () => {
    service.list.mockRejectedValue(new BadRequestException('Invalid cursor'));
    expect((await fetch(`${base}?cursor=zzz`)).status).toBe(400);
  });

  it('filters returns the service result', async () => {
    const res = await fetch(`${base}/filters`);
    expect(await res.json()).toEqual({ actors: [], agentNames: [], sources: [] });
    expect(service.filters).toHaveBeenCalledWith('org-1');
  });

  it('never lets the request change the organization', async () => {
    await fetch(`${base}?organizationId=org-2&orgId=org-2`);
    await fetch(`${base}/summary?organizationId=org-2`);
    await fetch(`${base}/filters?organizationId=org-2`);
    expect(service.list.mock.calls[0][0]).toBe('org-1');
    expect(service.summary.mock.calls[0][0]).toBe('org-1');
    expect(service.filters.mock.calls[0][0]).toBe('org-1');
  });

  describe('GET /groups/:group', () => {
    it('returns the service body to a USER-role member and passes the session org', async () => {
      role = 'USER';
      service.detail.mockResolvedValue({ group: 'g1', destinations: [] });
      const res = await fetch(`${base}/groups/g1?organizationId=org-2`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ group: 'g1', destinations: [] });
      expect(service.detail).toHaveBeenCalledWith('org-1', 'g1');
    });

    it('answers 404 with the same body for unknown and foreign groups', async () => {
      service.detail.mockRejectedValue(new NotFoundException('Group not found'));
      const a = await fetch(`${base}/groups/unknown`);
      const b = await fetch(`${base}/groups/foreign`);
      expect(a.status).toBe(404);
      expect(b.status).toBe(404);
      expect(await a.json()).toEqual(await b.json());
    });

    it('declares no policy check (every member may read)', () => {
      expect(
        Reflect.getMetadata(CHECK_POLICIES_KEY, AgentActivityController.prototype.detail)
      ).toBeUndefined();
    });
  });

  describe('actions', () => {
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('both routes require admin policy metadata', () => {
      for (const name of ['bulkApprovals', 'retryFailed'] as const) {
        expect(Reflect.getMetadata(CHECK_POLICIES_KEY, AgentActivityController.prototype[name])).toEqual([
          [AuthorizationActions.Create, Sections.ADMIN],
        ]);
      }
    });

    it('bulk passes org, user id, caller role and body', async () => {
      role = 'ADMIN';
      actions.bulkResolve.mockResolvedValue({ results: [], summary: { done: 0, skipped: 0, failed: 0 } });
      const res = await post('/approvals/bulk', { action: 'approve', approvalIds: ['a'] });
      expect(res.status).toBe(201);
      expect(actions.bulkResolve).toHaveBeenCalledWith(
        'org-1',
        'user-9',
        'ADMIN',
        expect.objectContaining({ action: 'approve', approvalIds: ['a'] })
      );
    });

    it('a missing role defaults to USER (service rejects)', async () => {
      actions.bulkResolve.mockResolvedValue({ results: [], summary: { done: 0, skipped: 0, failed: 0 } });
      await post('/approvals/bulk', { action: 'approve', approvalIds: ['a'] });
      expect(actions.bulkResolve.mock.calls[0][2]).toBe('USER');
    });

    it('51 ids is a 400 and the service is not called', async () => {
      const res = await post('/approvals/bulk', {
        action: 'approve',
        approvalIds: Array.from({ length: 51 }, (_, i) => `a${i}`),
      });
      expect(res.status).toBe(400);
      expect(actions.bulkResolve).not.toHaveBeenCalled();
    });

    it('retry-failed defaults includeUnknownOutcome to false', async () => {
      actions.retryFailed.mockResolvedValue({ group: 'g1', results: [], policy: {} });
      const res = await post('/groups/g1/retry-failed', {});
      expect(res.status).toBe(201);
      expect(actions.retryFailed).toHaveBeenCalledWith('org-1', 'g1', { includeUnknownOutcome: false });
    });

    it('retry-failed forwards includeUnknownOutcome true', async () => {
      actions.retryFailed.mockResolvedValue({ group: 'g1', results: [], policy: {} });
      await post('/groups/g1/retry-failed', { includeUnknownOutcome: true });
      expect(actions.retryFailed).toHaveBeenCalledWith('org-1', 'g1', { includeUnknownOutcome: true });
    });

    it('retry-failed rejects a non-boolean with 400', async () => {
      const res = await post('/groups/g1/retry-failed', { includeUnknownOutcome: 'yes' });
      expect(res.status).toBe(400);
      expect(actions.retryFailed).not.toHaveBeenCalled();
    });

    it('a service 404 and a 422 surface unchanged', async () => {
      actions.retryFailed.mockRejectedValueOnce(new NotFoundException('Group not found'));
      expect((await post('/groups/zzz/retry-failed', {})).status).toBe(404);
      actions.retryFailed.mockRejectedValueOnce(new HttpException({ error: 'policy_blocked' }, 422));
      expect((await post('/groups/g1/retry-failed', {})).status).toBe(422);
    });
  });
});
