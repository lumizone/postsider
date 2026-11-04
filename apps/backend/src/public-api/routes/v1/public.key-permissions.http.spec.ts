jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PublicWorkspaceController } from './public.workspace.controller';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { PublicApiIdempotencyService } from '@postsider/nestjs-libraries/database/prisma/idempotency/public-api-idempotency.service';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { PUBLIC_API_SCOPES } from '@postsider/nestjs-libraries/services/public-api-scopes';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';
import type { KeyPermissions } from '@postsider/nestjs-libraries/policies/key-permissions';

describe('API key permissions on public write paths', () => {
  let app: INestApplication;
  let base: string;
  let perms: KeyPermissions | undefined;
  const postsService = {
    mapTypeToPost: jest.fn(),
    validatePosts: jest.fn(),
    createPost: jest.fn(),
    buildPostUpdate: jest.fn(),
    getPost: jest.fn(),
    changePostStatus: jest.fn(),
    retryFailedByGroup: jest.fn(),
    getTopLevelPostsByGroup: jest.fn(),
    duplicatePost: jest.fn(),
    deletePost: jest.fn(),
    updateReleaseId: jest.fn(),
  };
  const approvals = { requestApprovalFromApi: jest.fn() };
  const idempotency = { claim: jest.fn(), complete: jest.fn(), release: jest.fn() };

  const draftOnly: KeyPermissions = { allowedActions: ['DRAFT'], allowedIntegrationIds: [] };

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [PostsService, postsService],
      [PublicApiIdempotencyService, idempotency],
    ]);
    const { ApprovalService } = await import(
      '@postsider/nestjs-libraries/database/prisma/approval/approval.service'
    );
    tokens.set(ApprovalService, approvals);
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicIntegrationsController, PublicWorkspaceController],
    })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', defaultTimezone: null, users: [{ role: 'SUPERADMIN' }] };
      req.publicApiScopes = [...PUBLIC_API_SCOPES];
      runWithActor(
        { type: 'API_KEY', id: 'k1', apiKeyId: 'k1' } as any,
        () => next(),
        perms ? { keyPermissions: perms } : undefined
      );
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    perms = undefined;
    idempotency.claim.mockResolvedValue(null);
    postsService.mapTypeToPost.mockImplementation(async (b: any) => b);
    postsService.validatePosts.mockResolvedValue([]);
    postsService.createPost.mockResolvedValue([{ postId: 'p1' }]);
    postsService.changePostStatus.mockResolvedValue({ ok: true });
    postsService.retryFailedByGroup.mockResolvedValue({ group: 'g1', results: [] });
    postsService.duplicatePost.mockResolvedValue({ duplicated: true });
    postsService.getPost.mockResolvedValue({ group: 'g1', integration: 'chA' });
    postsService.getTopLevelPostsByGroup.mockResolvedValue([
      { id: 'p1', state: 'ERROR', integrationId: 'chA' },
      { id: 'p2', state: 'PUBLISHED', integrationId: 'chB' },
    ]);
  });

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const createBody = (type: string, channels: string[] = ['chA']) => ({
    type,
    date: '2030-01-01T00:00:00.000Z',
    shortLink: false,
    tags: [],
    posts: channels.map((id) => ({ integration: { id }, value: [{ content: 'hi', image: [] }], settings: {} })),
  });

  const expectNoWrite = () => {
    expect(postsService.createPost).not.toHaveBeenCalled();
    expect(postsService.changePostStatus).not.toHaveBeenCalled();
    expect(postsService.retryFailedByGroup).not.toHaveBeenCalled();
    expect(postsService.duplicatePost).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
  };

  describe('POST /posts', () => {
    it('lets a DRAFT-only key create a draft', async () => {
      perms = draftOnly;
      const res = await send('POST', '/posts', createBody('draft'));
      expect(res.status).toBe(201);
      expect(postsService.createPost).toHaveBeenCalledTimes(1);
    });

    it.each(['schedule', 'now'])('refuses type %s for a DRAFT-only key', async (type) => {
      perms = draftOnly;
      const res = await send('POST', '/posts', createBody(type));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('key_action_not_allowed');
      expect(json.action).toBe(type === 'now' ? 'PUBLISH_NOW' : 'SCHEDULE');
      expectNoWrite();
    });

    it('refuses a second channel outside the key channel list', async () => {
      perms = { allowedActions: [], allowedIntegrationIds: ['chA'] };
      const res = await send('POST', '/posts', createBody('schedule', ['chA', 'chB']));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('key_channel_not_allowed');
      expect(json.integrationId).toBe('chB');
      expectNoWrite();
    });

    it('reports the action violation before the channel violation', async () => {
      perms = { allowedActions: ['DRAFT'], allowedIntegrationIds: ['chA'] };
      const res = await send('POST', '/posts', createBody('now', ['chB']));
      expect((await res.json()).error).toBe('key_action_not_allowed');
    });

    it('behaves as before for a key without limits', async () => {
      const res = await send('POST', '/posts', createBody('now', ['chB']));
      expect(res.status).toBe(201);
      expect(postsService.createPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('PUT /posts/:id', () => {
    const stored = (state: string) =>
      postsService.buildPostUpdate.mockResolvedValue({
        state,
        dto: { type: state === 'DRAFT' ? 'draft' : 'update', posts: [{ integration: { id: 'chA' }, value: [] }] },
      });

    it('lets a DRAFT-only key edit a stored draft', async () => {
      perms = draftOnly;
      stored('DRAFT');
      const res = await send('PUT', '/posts/p1', { content: 'x' });
      expect(res.status).toBe(200);
      expect(postsService.createPost).toHaveBeenCalledTimes(1);
    });

    it('refuses editing a queued post for a DRAFT-only key', async () => {
      perms = draftOnly;
      stored('QUEUE');
      const res = await send('PUT', '/posts/p1', { content: 'x' });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('key_action_not_allowed');
      expectNoWrite();
    });

    it('refuses editing a post of a forbidden channel', async () => {
      perms = { allowedActions: [], allowedIntegrationIds: ['chZ'] };
      stored('QUEUE');
      const res = await send('PUT', '/posts/p1', { content: 'x' });
      expect((await res.json()).error).toBe('key_channel_not_allowed');
      expectNoWrite();
    });
  });

  describe('PUT /posts/:id/status', () => {
    it('lets a DRAFT-only key move a post to draft', async () => {
      perms = draftOnly;
      const res = await send('PUT', '/posts/p1/status', { status: 'draft' });
      expect(res.status).toBe(200);
      expect(postsService.changePostStatus).toHaveBeenCalledWith('org-1', 'p1', 'draft');
    });

    it('refuses scheduling for a DRAFT-only key', async () => {
      perms = draftOnly;
      const res = await send('PUT', '/posts/p1/status', { status: 'schedule' });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('key_action_not_allowed');
      expectNoWrite();
    });

    it('refuses a post of a forbidden channel', async () => {
      perms = { allowedActions: [], allowedIntegrationIds: ['chZ'] };
      const res = await send('PUT', '/posts/p1/status', { status: 'draft' });
      expect((await res.json()).error).toBe('key_channel_not_allowed');
      expectNoWrite();
    });

    it('does not load the post for a key without limits', async () => {
      const res = await send('PUT', '/posts/p1/status', { status: 'schedule' });
      expect(res.status).toBe(200);
      expect(postsService.getPost).not.toHaveBeenCalled();
    });
  });

  describe('POST /posts/group/:group/retry-failed', () => {
    it('refuses a DRAFT-only key (retry re-arms the post)', async () => {
      perms = draftOnly;
      const res = await send('POST', '/posts/group/g1/retry-failed', {});
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('key_action_not_allowed');
      expectNoWrite();
    });

    it('refuses when an ERROR row sits on a forbidden channel', async () => {
      perms = { allowedActions: [], allowedIntegrationIds: ['chB'] };
      const res = await send('POST', '/posts/group/g1/retry-failed', {});
      const json = await res.json();
      expect(json.error).toBe('key_channel_not_allowed');
      expect(json.integrationId).toBe('chA');
      expectNoWrite();
    });

    it('ignores channels of rows that are not retried', async () => {
      perms = { allowedActions: [], allowedIntegrationIds: ['chA'] };
      const res = await send('POST', '/posts/group/g1/retry-failed', {});
      expect(res.status).toBe(201);
      expect(postsService.retryFailedByGroup).toHaveBeenCalledTimes(1);
    });

    it('is not restricted when no row failed', async () => {
      perms = draftOnly;
      postsService.getTopLevelPostsByGroup.mockResolvedValue([
        { id: 'p2', state: 'PUBLISHED', integrationId: 'chB' },
      ]);
      const res = await send('POST', '/posts/group/g1/retry-failed', {});
      expect(res.status).toBe(201);
    });
  });

  describe('POST /posts/:id/duplicate', () => {
    it('lets a DRAFT-only key duplicate (the copy is a draft)', async () => {
      perms = draftOnly;
      const res = await send('POST', '/posts/p1/duplicate', {});
      expect(res.status).toBe(201);
      expect(postsService.duplicatePost).toHaveBeenCalledTimes(1);
    });

    it('refuses duplicating onto a forbidden target channel', async () => {
      perms = { allowedActions: [], allowedIntegrationIds: ['chA'] };
      const res = await send('POST', '/posts/p1/duplicate', { channelId: 'chB' });
      expect((await res.json()).error).toBe('key_channel_not_allowed');
      expectNoWrite();
    });

    it('checks the source channel when no target is given', async () => {
      perms = { allowedActions: [], allowedIntegrationIds: ['chZ'] };
      const res = await send('POST', '/posts/p1/duplicate', {});
      expect((await res.json()).error).toBe('key_channel_not_allowed');
      expectNoWrite();
    });

    it('refuses a key that may not create drafts', async () => {
      perms = { allowedActions: ['SCHEDULE'], allowedIntegrationIds: [] };
      const res = await send('POST', '/posts/p1/duplicate', {});
      expect((await res.json()).error).toBe('key_action_not_allowed');
      expectNoWrite();
    });
  });

  describe('paths that stay unrestricted', () => {
    it('delete, request-approval and release-id work for a DRAFT-only key', async () => {
      perms = draftOnly;
      postsService.getPost.mockResolvedValue({ group: 'g1', integration: 'chA' });
      postsService.deletePost.mockResolvedValue({ ok: true });
      postsService.updateReleaseId.mockResolvedValue({ ok: true });
      approvals.requestApprovalFromApi.mockResolvedValue({ id: 'a1', postId: 'p1', status: 'PENDING', created: true });
      expect((await send('DELETE', '/posts/p1')).status).toBe(200);
      expect((await send('PUT', '/posts/p1/release-id', { releaseId: 'r' })).status).toBe(200);
      expect((await send('POST', '/posts/p1/request-approval')).status).toBe(201);
    });
  });
});
