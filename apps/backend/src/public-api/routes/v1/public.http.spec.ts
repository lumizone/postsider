jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));
jest.mock('@postsider/nestjs-libraries/upload/detect-file-type', () => ({
  detectFileType: async (b: Buffer) =>
    b.subarray(1, 4).toString() === 'PNG' ? { mime: 'image/png', ext: 'png' } : undefined,
}));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import type { AddressInfo } from 'net';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PublicWorkspaceController } from './public.workspace.controller';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { MediaService } from '@postsider/nestjs-libraries/database/prisma/media/media.service';
import { PostCheckerService } from '@postsider/nestjs-libraries/post-checker/post-checker.service';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { PostValidationExceptionFilter } from '@postsider/backend/api/routes/posts.validation.exception';
import { LARGE_JSON_LIMIT, LARGE_JSON_PATHS } from '../../../large-json.paths';

/**
 * Real HTTP through Nest's router, pipes and filters (only the services are
 * stubbed), so route collisions, DTO parsing and the body-size limits are
 * exercised rather than assumed.
 */
describe('Public API over HTTP', () => {
  let app: INestApplication;
  let base: string;
  let role = 'SUPERADMIN';

  const channel = { id: 'c1', deletedAt: null, providerIdentifier: 'x', postingTimes: '[]', timezone: null };
  const posts = [
    { id: 'a', state: 'ERROR', integration: { id: 'c1' } },
    { id: 'b', state: 'QUEUE', integration: { id: 'c1' } },
    { id: 'c', state: 'ERROR', integration: { id: 'c2' } },
  ];
  const integrationService = {
    getIntegrationById: jest.fn(),
    setTimes: jest.fn(),
    disableChannel: jest.fn(),
    deleteChannel: jest.fn().mockResolvedValue({ ok: true }),
  };
  const postsService = {
    getPosts: jest.fn(),
    buildPostUpdate: jest.fn(),
    mapTypeToPost: jest.fn(),
    validatePosts: jest.fn(),
    createPost: jest.fn(),
  };
  const mediaService = { saveFile: jest.fn(), getMedia: jest.fn().mockResolvedValue({ results: [] }) };
  const postChecker = { check: jest.fn(), rewrite: jest.fn() };

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [IntegrationService, integrationService],
      [PostsService, postsService],
      [MediaService, mediaService],
      [PostCheckerService, postChecker],
    ]);
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicIntegrationsController, PublicWorkspaceController],
    })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();

    app = moduleRef.createNestApplication();
    // Same wiring as main.ts, in the same order.
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter(), new PostValidationExceptionFilter());
    app.use(LARGE_JSON_PATHS, (req: any, res: any, next: any) =>
      json({ limit: LARGE_JSON_LIMIT })(req, res, next)
    );
    // Stand-in for PublicAuthMiddleware.
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', defaultTimezone: null, users: [{ role }] };
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    role = 'SUPERADMIN';
    integrationService.getIntegrationById.mockResolvedValue(channel);
    integrationService.setTimes.mockResolvedValue(channel);
    postsService.getPosts.mockResolvedValue(posts);
  });

  const send = (method: string, path: string, body?: unknown) =>
    fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  describe('GET /posts', () => {
    it('accepts the extra filter and paging params next to the DTO', async () => {
      const res = await send('GET', '/posts?startDate=2026-06-01&endDate=2026-06-30&state=ERROR&limit=1&page=2');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ posts: [{ id: 'c' }], total: 2, page: 2, hasMore: false });
    });

    it('still answers {posts} when nothing new is passed', async () => {
      const res = await send('GET', '/posts?startDate=2026-06-01&endDate=2026-06-30');
      expect(await res.json()).toEqual({ posts });
    });
  });

  describe('hostile query and body shapes', () => {
    it('ignores object-shaped filters instead of crashing', async () => {
      const res = await send('GET', '/posts?startDate=2026-06-01&endDate=2026-06-30&state[x]=y&integration[a]=b&limit[z]=1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ posts });
    });

    it('refuses object-shaped ids in a duplicate request', async () => {
      const res = await send('POST', '/posts/p1/duplicate', { channelId: { contains: '' } });
      expect(res.status).toBe(400);
    });

    it('does not pass an object search to the media library', async () => {
      const res = await send('GET', '/media?search[contains]=x');
      expect(res.status).toBe(200);
      expect(mediaService.getMedia).toHaveBeenCalledWith('org-1', 1, undefined);
    });
  });

  describe('PUT /posts/:id', () => {
    it('refuses an empty edit', async () => {
      const res = await send('PUT', '/posts/p1', {});
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain('Nothing to update');
      expect(postsService.buildPostUpdate).not.toHaveBeenCalled();
    });

    it('builds the update, validates it and saves it as an API edit', async () => {
      const dto = { type: 'draft', posts: [{ integration: { id: 'c1' }, value: [], settings: {} }] };
      postsService.buildPostUpdate.mockResolvedValue({ dto, state: 'DRAFT' });
      postsService.mapTypeToPost.mockResolvedValue(dto);
      postsService.validatePosts.mockResolvedValue([]);
      postsService.createPost.mockResolvedValue([{ postId: 'p1' }]);

      const res = await send('PUT', '/posts/p1', { content: 'new', images: [], firstComment: null });
      expect(res.status).toBe(200);
      expect(postsService.buildPostUpdate).toHaveBeenCalledWith('org-1', 'p1', {
        content: 'new',
        images: [],
        date: undefined,
        settings: undefined,
        firstComment: null,
      });
      // The type stays what buildPostUpdate chose (draft) rather than being forced.
      expect(postsService.validatePosts.mock.calls[0][2]).toBe('draft');
      expect(postsService.createPost).toHaveBeenCalledWith('org-1', dto, 'API');
    });

    it('reports a per-channel validation failure with its text', async () => {
      const dto = { type: 'update', posts: [] };
      postsService.buildPostUpdate.mockResolvedValue({ dto, state: 'QUEUE' });
      postsService.mapTypeToPost.mockResolvedValue(dto);
      postsService.validatePosts.mockResolvedValue([
        { identifier: 'x', name: 'X', emptyContent: false, valid: true, errors: true, tooLong: true },
      ]);
      const res = await send('PUT', '/posts/p1', { content: 'long' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ provider: 'x', name: 'X', message: 'post is too long, please fix it' });
      expect(postsService.createPost).not.toHaveBeenCalled();
    });
  });

  describe('channel routes', () => {
    it('routes to the workspace controller and parses the queue-plan DTO', async () => {
      const res = await send('PUT', '/integrations/c1/queue-plan', { time: [{ time: 540 }], timezone: 'Europe/Warsaw' });
      expect(res.status).toBe(200);
      expect(integrationService.setTimes).toHaveBeenCalledWith(
        'org-1',
        'c1',
        expect.objectContaining({ time: [{ time: 540 }], timezone: 'Europe/Warsaw' })
      );
    });

    it('keeps weekday restrictions and rejects an impossible weekday', async () => {
      const ok = await send('PUT', '/integrations/c1/queue-plan', { time: [{ time: 540, days: [1, 3] }] });
      expect(ok.status).toBe(200);
      expect(integrationService.setTimes.mock.calls[0][2].time[0].days).toEqual([1, 3]);

      integrationService.setTimes.mockClear();
      const bad = await send('PUT', '/integrations/c1/queue-plan', { time: [{ time: 540, days: [7] }] });
      expect(bad.status).toBe(400);
      expect(integrationService.setTimes).not.toHaveBeenCalled();
    });

    it('rejects a malformed queue plan before touching the channel', async () => {
      const res = await send('PUT', '/integrations/c1/queue-plan', { time: 'nine' });
      expect(res.status).toBe(400);
      expect(integrationService.setTimes).not.toHaveBeenCalled();
    });

    it('returns 403 for a plain member and never the channel row', async () => {
      role = 'USER';
      const denied = await send('POST', '/integrations/c1/disable');
      expect(denied.status).toBe(403);

      role = 'ADMIN';
      integrationService.disableChannel.mockResolvedValue({ ...channel, token: 'SECRET' });
      const ok = await send('POST', '/integrations/c1/disable');
      expect(ok.status).toBe(201);
      expect(JSON.stringify(await ok.json())).not.toContain('SECRET');
    });

    it('keeps DELETE /integrations/:id on the original controller', async () => {
      const res = await send('DELETE', '/integrations/c1');
      expect(res.status).not.toBe(404);
    });
  });

  describe('POST /posts/check', () => {
    it('is routed to the checker (not swallowed by POST /posts) and validates the DTO', async () => {
      const bad = await send('POST', '/posts/check', { content: 'hi' });
      expect(bad.status).toBe(400);

      postChecker.check.mockResolvedValue({ ok: true });
      const good = await send('POST', '/posts/check', { content: 'hi', hasMedia: false, platforms: ['x'] });
      expect(good.status).toBe(201);
      expect(postChecker.check).toHaveBeenCalled();
    });
  });

  describe('POST /upload-base64', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300 * 1024, 1)]);

    it('accepts a payload far above the 100 KB default JSON limit', async () => {
      mediaService.saveFile.mockResolvedValue({ id: 'm1', path: 'image/x.png' });
      const storage = (app.get(PublicIntegrationsController) as any).storage;
      storage.uploadFile = jest.fn().mockResolvedValue({ originalname: 'x.png', path: 'image/x.png', kind: 'image' });

      const res = await send('POST', '/upload-base64', { data: png.toString('base64'), filename: 'big.png' });
      expect(png.length * (4 / 3)).toBeGreaterThan(100 * 1024);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: 'm1', path: 'image/x.png' });
    });
  });
});
