jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';

describe('publish reliability fields exposure', () => {
  it('getPosts selects the failure fields and keeps previous keys', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new PostsRepository(
      { model: { post: { findMany } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await repo.getPosts('org-1', {
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    } as any);

    const select = findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({
      errorCategory: true,
      errorRetryable: true,
      publishAttempts: true,
      lastPublishAttemptAt: true,
      id: true,
      state: true,
      releaseId: true,
      group: true,
    });
  });

  it('getPost carries the four fields and never the integration token', async () => {
    const service = Object.create(PostsService.prototype) as any;
    const at = new Date('2026-11-04T10:00:00Z');
    service.getPostsRecursively = async () => [
      {
        id: 'p1',
        group: 'g',
        integrationId: 'i',
        settings: '{}',
        image: '[]',
        errorCategory: 'UNKNOWN_OUTCOME',
        errorRetryable: false,
        publishAttempts: 2,
        lastPublishAttemptAt: at,
        integration: { id: 'i', picture: null, token: 'secret' },
      },
    ];
    service.updateMedia = async () => [];

    const result = await PostsService.prototype.getPost.call(
      service,
      'org-1',
      'p1'
    );

    expect(result.posts[0]).toMatchObject({
      errorCategory: 'UNKNOWN_OUTCOME',
      errorRetryable: false,
      publishAttempts: 2,
      lastPublishAttemptAt: at,
    });
    expect(result.posts[0].integration).not.toHaveProperty('token');
  });
});
