jest.mock('./approval.repository', () => ({ ApprovalRepository: jest.fn() }));
jest.mock('@postsider/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: jest.fn() }));
jest.mock('@postsider/nestjs-libraries/database/prisma/notifications/notification.service', () => ({
  NotificationService: jest.fn(),
}));
jest.mock('@postsider/nestjs-libraries/database/prisma/organizations/organization.repository', () => ({
  OrganizationRepository: jest.fn(),
}));

import { ApprovalService } from './approval.service';
import { decodeCursor, encodeCursor } from './approval-public.view';

const mkRow = (id: string, iso: string, over: Record<string, any> = {}) => ({
  id,
  postId: `p-${id}`,
  status: 'PENDING',
  note: null,
  requestedAt: new Date(iso),
  resolvedAt: null,
  requestedByType: 'API_KEY',
  requestedByApiKeyId: 'k1',
  currentStage: 1,
  flowId: null,
  flow: null,
  stages: [],
  post: { integration: { id: 'c1', name: 'Page', providerIdentifier: 'x' } },
  ...over,
});

function make(rows: any[] = []) {
  const repo = {
    listForPublicApi: jest.fn().mockResolvedValue(rows),
    getForPublicApi: jest.fn(),
  };
  const svc = new ApprovalService(repo as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, repo };
}

describe('ApprovalService.listForApi', () => {
  it('scopes the query to the organization and passes status, since and limit + 1', async () => {
    const { svc, repo } = make([]);
    await svc.listForApi('org-1', { status: 'APPROVED', limit: 10, since: '2026-11-01T00:00:00Z' });
    expect(repo.listForPublicApi).toHaveBeenCalledWith('org-1', {
      status: 'APPROVED',
      since: new Date('2026-11-01T00:00:00Z'),
      take: 11,
    });
  });

  it('defaults to 25 and clamps to 100', async () => {
    const { svc, repo } = make([]);
    await svc.listForApi('org-1', {});
    expect(repo.listForPublicApi.mock.calls[0][1].take).toBe(26);
    await svc.listForApi('org-1', { limit: 5000 });
    expect(repo.listForPublicApi.mock.calls[1][1].take).toBe(101);
  });

  it('returns a nextCursor from the last kept row only when there is another row', async () => {
    const rows = [
      mkRow('b', '2026-11-02T00:00:00.000Z'),
      mkRow('a', '2026-11-01T00:00:00.000Z'),
      mkRow('0', '2026-10-31T00:00:00.000Z'),
    ];
    const { svc } = make(rows);
    const page = await svc.listForApi('org-1', { limit: 2 });
    expect(page.items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(decodeCursor(page.nextCursor as string)).toEqual({
      requestedAt: new Date('2026-11-01T00:00:00.000Z'),
      id: 'a',
    });
    const last = await make(rows.slice(0, 2)).svc.listForApi('org-1', { limit: 2 });
    expect(last.nextCursor).toBeNull();
  });

  it('decodes the cursor into the keyset the repository filters on (ties are broken by id)', async () => {
    const { svc, repo } = make([]);
    const at = new Date('2026-11-01T00:00:00.000Z');
    await svc.listForApi('org-1', { cursor: encodeCursor({ requestedAt: at, id: 'zz' }) });
    expect(repo.listForPublicApi.mock.calls[0][1].cursor).toEqual({ requestedAt: at, id: 'zz' });
  });

  it('an invalid cursor is a 400 and nothing is queried', async () => {
    const { svc, repo } = make([]);
    await expect(svc.listForApi('org-1', { cursor: 'not-a-cursor' })).rejects.toMatchObject({ status: 400 });
    expect(repo.listForPublicApi).not.toHaveBeenCalled();
  });

  it('items never carry token material', async () => {
    const { svc } = make([
      mkRow('a', '2026-11-01T00:00:00.000Z', { guestToken: 's', guestTokenHash: 'h', requestedById: 'u', organizationId: 'o' }),
    ]);
    const json = JSON.stringify(await svc.listForApi('org-1', {}));
    expect(json).not.toMatch(/guestToken|requestedById|organizationId/);
  });
});

describe('ApprovalService.getDetailForApi', () => {
  it('adds a plain text preview cut to 500 characters', async () => {
    const { svc, repo } = make();
    repo.getForPublicApi.mockResolvedValue(
      mkRow('a', '2026-11-01T00:00:00.000Z', {
        post: { content: `<p>${'word '.repeat(300)}</p>`, integration: { id: 'c1', name: 'P', providerIdentifier: 'x' } },
      })
    );
    const out = await svc.getDetailForApi('org-1', 'a');
    expect(repo.getForPublicApi).toHaveBeenCalledWith('org-1', 'a');
    expect(out.preview.length).toBeLessThanOrEqual(500);
    expect(out.preview.startsWith('word word')).toBe(true);
  });

  it('is 404 for an unknown or foreign id', async () => {
    const { svc, repo } = make();
    repo.getForPublicApi.mockResolvedValue(null);
    await expect(svc.getDetailForApi('org-1', 'x')).rejects.toMatchObject({ status: 404 });
  });
});
