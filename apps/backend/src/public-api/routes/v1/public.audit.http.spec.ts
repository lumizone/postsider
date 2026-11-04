jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicAuditController } from './public.audit.controller';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { AuditEventsService } from '@postsider/nestjs-libraries/database/prisma/audit/audit-events.service';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';

describe('Audit read API', () => {
  let app: INestApplication;
  let base: string;
  let scopes: string[] = [];
  const audit = { list: jest.fn() };
  const postsService = { getPostIdsInGroupIncludingDeleted: jest.fn() };

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [AuditEventsService, audit],
      [PostsService, postsService],
    ]);
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicAuditController, PublicIntegrationsController],
    })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', defaultTimezone: null, users: [{ role: 'SUPERADMIN' }] };
      req.publicApiScopes = scopes;
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    scopes = ['audit:read', 'posts:read'];
    audit.list.mockResolvedValue({ events: [], nextCursor: null });
    postsService.getPostIdsInGroupIncludingDeleted.mockResolvedValue(['p1', 'c1']);
  });

  describe('GET /audit-events', () => {
    it('requires audit:read', async () => {
      scopes = ['posts:read', 'posts:write'];
      expect((await fetch(`${base}/audit-events`)).status).toBe(403);
      expect(audit.list).not.toHaveBeenCalled();
    });

    it('lists with the default limit', async () => {
      const res = await fetch(`${base}/audit-events`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ events: [], nextCursor: null });
      expect(audit.list).toHaveBeenCalledWith('org-1', { limit: 25 });
    });

    it.each(['limit=101', 'limit=0', 'type=post.exploded', 'from=2026-02-01&to=2026-01-01', 'from=garbage'])(
      'rejects %s',
      async (qs) => {
        expect((await fetch(`${base}/audit-events?${qs}`)).status).toBe(400);
        expect(audit.list).not.toHaveBeenCalled();
      }
    );

    it('answers 400 for a malformed cursor', async () => {
      audit.list.mockRejectedValue(new BadRequestException('Invalid cursor'));
      expect((await fetch(`${base}/audit-events?cursor=abc`)).status).toBe(400);
    });

    it('passes parsed filters', async () => {
      await fetch(`${base}/audit-events?targetType=post&targetId=p1&type=post.published&limit=10`);
      expect(audit.list).toHaveBeenCalledWith('org-1', {
        targetType: 'post',
        targetIds: ['p1'],
        type: 'post.published',
        limit: 10,
      });
    });

    it('always uses the authenticated organization', async () => {
      await fetch(`${base}/audit-events?organizationId=other`);
      expect(audit.list.mock.calls[0][0]).toBe('org-1');
      expect(audit.list.mock.calls[0][1]).not.toHaveProperty('organizationId');
    });
  });

  describe('GET /posts/:id/activity', () => {
    it('lists activity for the whole post group', async () => {
      const res = await fetch(`${base}/posts/p1/activity?limit=5`);
      expect(res.status).toBe(200);
      expect(postsService.getPostIdsInGroupIncludingDeleted).toHaveBeenCalledWith('org-1', 'p1');
      expect(audit.list).toHaveBeenCalledWith('org-1', { targetType: 'post', targetIds: ['p1', 'c1'], limit: 5 });
    });

    it('answers 404 for an unknown or foreign post', async () => {
      postsService.getPostIdsInGroupIncludingDeleted.mockResolvedValue(null);
      expect((await fetch(`${base}/posts/zzz/activity`)).status).toBe(404);
      expect(audit.list).not.toHaveBeenCalled();
    });

    it('requires posts:read', async () => {
      scopes = ['audit:read'];
      expect((await fetch(`${base}/posts/p1/activity`)).status).toBe(403);
      expect(audit.list).not.toHaveBeenCalled();
    });

    it('validates query parameters', async () => {
      expect((await fetch(`${base}/posts/p1/activity?limit=500`)).status).toBe(400);
      expect((await fetch(`${base}/posts/p1/activity?from=2026-02-01&to=2026-01-01`)).status).toBe(400);
    });
  });
});
