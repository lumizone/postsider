jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { PublicIntegrationsController } from './public.integrations.controller';

describe('PublicIntegrationsController.getPosts', () => {
  const org = { id: 'org-1' } as any;
  const query = { startDate: '2026-06-01', endDate: '2026-06-30' } as any;
  const rows = [
    { id: 'a', state: 'ERROR', integration: { id: 'c1' } },
    { id: 'b', state: 'QUEUE', integration: { id: 'c1' } },
    { id: 'c', state: 'ERROR', integration: { id: 'c2' } },
    { id: 'd', state: 'DRAFT', integration: { id: 'c2' } },
  ];
  const controller = () => {
    const c = Object.create(PublicIntegrationsController.prototype) as any;
    c._postsService = { getPosts: jest.fn().mockResolvedValue(rows) };
    return c as PublicIntegrationsController;
  };

  it('keeps the legacy response when no filter or paging is given', async () => {
    expect(await controller().getPosts(org, query)).toEqual({ posts: rows });
  });

  it('filters by state (case-insensitive) and channel', async () => {
    const byState = await controller().getPosts(org, query, 'error');
    expect(byState.posts.map((p: any) => p.id)).toEqual(['a', 'c']);

    const both = await controller().getPosts(org, query, 'ERROR', 'c2');
    expect(both.posts.map((p: any) => p.id)).toEqual(['c']);
  });

  it('pages the filtered list and reports whether more remain', async () => {
    const first = (await controller().getPosts(org, query, undefined, undefined, '1', '3')) as any;
    expect(first.posts.map((p: any) => p.id)).toEqual(['a', 'b', 'c']);
    expect(first).toMatchObject({ total: 4, page: 1, hasMore: true });

    const second = (await controller().getPosts(org, query, undefined, undefined, '2', '3')) as any;
    expect(second.posts.map((p: any) => p.id)).toEqual(['d']);
    expect(second.hasMore).toBe(false);
  });

  it('caps the page size at 200', async () => {
    const res = (await controller().getPosts(org, query, undefined, undefined, '1', '9999')) as any;
    expect(res.total).toBe(4);
    expect(res.posts).toHaveLength(4);
  });
});
