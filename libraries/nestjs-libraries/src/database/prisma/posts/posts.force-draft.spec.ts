jest.mock('isomorphic-dompurify', () => ({
  sanitize: (value: string) => value,
}));

import { PostsService } from './posts.service';

describe('PostsService.createPost forceDraftIntegrationIds', () => {
  const build = () => {
    const posts = {
      createOrUpdatePost: jest.fn().mockImplementation(async (type: string, _o: string, _d: string, post: any) => ({
        posts: [
          {
            id: `post-${post.integration.id}`,
            state: type === 'draft' ? 'DRAFT' : 'QUEUE',
            settings: { __type: 'x-post' },
          },
        ],
      })),
    };
    const subscription = {
      reserveMonthlyPostSlots: jest.fn().mockResolvedValue(null),
      releaseMonthlyPostReservation: jest.fn().mockResolvedValue(undefined),
      reserveTrialXPosts: jest.fn().mockResolvedValue(null),
      releaseTrialXReservation: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PostsService(
      posts as any,
      { getSocialIntegration: jest.fn().mockReturnValue({}) } as any,
      { getIntegrationById: jest.fn().mockResolvedValue({ providerIdentifier: 'linkedin' }) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      subscription as any,
      { getPublishingState: jest.fn().mockResolvedValue({ publishingState: 'ACTIVE' }) } as any,
      {} as any
    );
    const startWorkflow = jest.fn().mockResolvedValue(undefined);
    (service as any).startWorkflow = startWorkflow;
    return { service, posts, subscription, startWorkflow };
  };

  const body = (type: 'schedule' | 'now') =>
    ({
      type,
      date: new Date(Date.now() + 3_600_000).toISOString(),
      tags: [],
      shortLink: false,
      posts: ['a', 'b'].map((id) => ({
        integration: { id },
        value: [
          { content: 'one', image: [] },
          { content: 'two', image: [] },
        ],
        settings: { __type: 'x-post' },
      })),
    }) as any;

  it.each(['schedule', 'now'] as const)('creates the forced channel as draft for a %s request, the other as requested', async (type) => {
    const { service, posts, startWorkflow, subscription } = build();
    await service.createPost('org-1', body(type), 'API' as any, {
      forceDraftIntegrationIds: new Set(['b']),
    });

    const types = posts.createOrUpdatePost.mock.calls.map((c) => [c[3].integration.id, c[0]]);
    expect(types).toEqual([
      ['a', type],
      ['b', 'draft'],
    ]);
    // Only the non forced post arms a workflow.
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(startWorkflow.mock.calls[0][1]).toBe('post-a');
    // Monthly slots: 2 values of channel a only.
    expect(subscription.reserveMonthlyPostSlots).toHaveBeenCalledWith('org-1', 2);
  });

  it('reserves nothing when every channel is forced to draft', async () => {
    const { service, subscription, startWorkflow } = build();
    await service.createPost('org-1', body('schedule'), 'API' as any, {
      forceDraftIntegrationIds: new Set(['a', 'b']),
    });
    expect(subscription.reserveMonthlyPostSlots).toHaveBeenCalledWith('org-1', 0);
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  it('without the option nothing changes', async () => {
    const { service, posts, subscription } = build();
    await service.createPost('org-1', body('schedule'), 'API' as any);
    expect(posts.createOrUpdatePost.mock.calls.map((c) => c[0])).toEqual(['schedule', 'schedule']);
    expect(subscription.reserveMonthlyPostSlots).toHaveBeenCalledWith('org-1', 4);
  });
});
