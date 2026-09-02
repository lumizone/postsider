jest.mock('isomorphic-dompurify', () => ({
  sanitize: (value: string) => value,
}));

import { PostsService } from './posts.service';

describe('PostsService monthly post quota reservation', () => {
  const createPostService = () => {
    const posts = {
      createOrUpdatePost: jest.fn().mockResolvedValue({
        posts: [
          { id: 'post-1', state: 'QUEUE', settings: { __type: 'x-post' } },
        ],
      }),
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
      {
        getIntegrationById: jest
          .fn()
          .mockResolvedValue({ providerIdentifier: 'linkedin' }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      subscription as any,
      {
        getPublishingState: jest
          .fn()
          .mockResolvedValue({ publishingState: 'ACTIVE' }),
      } as any,
      {} as any
    );
    (service as any).startWorkflow = jest.fn().mockResolvedValue(undefined);
    return { service, posts };
  };

  it('rejects a scheduled date more than one minute in the past', async () => {
    const { service, posts } = createPostService();

    await expect(
      service.createPost(
        'org-1',
        {
          type: 'schedule',
          date: new Date(Date.now() - 61_000).toISOString(),
          tags: [],
          shortLink: false,
          posts: [
            {
              integration: { id: 'channel-1' },
              value: [{ content: 'one', image: [] }],
              settings: { __type: 'x-post' },
            },
          ],
        } as any,
        'WEB' as any
      )
    ).rejects.toThrow('Scheduled date cannot be in the past');

    expect(posts.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('allows a scheduled date within the one-minute clock skew', async () => {
    const { service, posts } = createPostService();

    await expect(
      service.createPost(
        'org-1',
        {
          type: 'schedule',
          date: new Date(Date.now() - 30_000).toISOString(),
          tags: [],
          shortLink: false,
          posts: [
            {
              integration: { id: 'channel-1' },
              value: [{ content: 'one', image: [] }],
              settings: { __type: 'x-post' },
            },
          ],
        } as any,
        'WEB' as any
      )
    ).resolves.toHaveLength(1);

    expect(posts.createOrUpdatePost).toHaveBeenCalledTimes(1);
  });

  it.each(['now', 'draft'] as const)(
    'preserves past dates for type %s',
    async (type) => {
      const { service, posts } = createPostService();

      await expect(
        service.createPost(
          'org-1',
          {
            type,
            date: '2020-01-01T00:00:00.000Z',
            tags: [],
            shortLink: false,
            posts: [
              {
                integration: { id: 'channel-1' },
                value: [{ content: 'one', image: [] }],
                settings: { __type: 'x-post' },
              },
            ],
          } as any,
          'WEB' as any
        )
      ).resolves.toHaveLength(1);

      expect(posts.createOrUpdatePost).toHaveBeenCalledTimes(1);
    }
  );

  it('reserves and releases one monthly slot for every target and thread entry in a scheduled batch', async () => {
    const posts = {
      createOrUpdatePost: jest.fn().mockResolvedValue({
        posts: [
          { id: 'post-1', state: 'QUEUE', settings: { __type: 'x-post' } },
        ],
      }),
    };
    const integrations = {
      getIntegrationById: jest
        .fn()
        .mockResolvedValue({ providerIdentifier: 'linkedin' }),
    };
    const subscription = {
      reserveMonthlyPostSlots: jest
        .fn()
        .mockResolvedValue('monthly-reservation'),
      releaseMonthlyPostReservation: jest.fn().mockResolvedValue(undefined),
      reserveTrialXPosts: jest.fn().mockResolvedValue(null),
      releaseTrialXReservation: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PostsService(
      posts as any,
      { getSocialIntegration: jest.fn().mockReturnValue({}) } as any,
      integrations as any,
      {} as any,
      {
        convertTextToShortLinks: jest.fn().mockResolvedValue(['one', 'two']),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      subscription as any,
      {
        getPublishingState: jest
          .fn()
          .mockResolvedValue({ publishingState: 'ACTIVE' }),
      } as any,
      {} as any
    );
    (service as any).startWorkflow = jest.fn().mockResolvedValue(undefined);

    await service.createPost(
      'org-1',
      {
        type: 'schedule',
        date: new Date(Date.now() + 60_000).toISOString(),
        tags: [],
        shortLink: false,
        posts: [
          {
            integration: { id: 'channel-1' },
            value: [
              { content: 'one', image: [] },
              { content: 'two', image: [] },
            ],
            settings: { __type: 'x-post' },
          },
          {
            integration: { id: 'channel-2' },
            value: [
              { content: 'one', image: [] },
              { content: 'two', image: [] },
            ],
            settings: { __type: 'x-post' },
          },
        ],
      } as any,
      'WEB' as any
    );

    expect(subscription.reserveMonthlyPostSlots).toHaveBeenCalledWith(
      'org-1',
      4
    );
    expect(subscription.releaseMonthlyPostReservation).toHaveBeenCalledWith(
      'monthly-reservation'
    );
  });

  it('reserves a slot when an update appends a thread entry without an id', async () => {
    const posts = {
      createOrUpdatePost: jest.fn().mockResolvedValue({
        posts: [
          {
            id: 'new-thread-post',
            state: 'QUEUE',
            settings: { __type: 'x-post' },
          },
        ],
      }),
    };
    const subscription = {
      reserveMonthlyPostSlots: jest
        .fn()
        .mockResolvedValue('monthly-reservation'),
      releaseMonthlyPostReservation: jest.fn().mockResolvedValue(undefined),
      reserveTrialXPosts: jest.fn().mockResolvedValue(null),
      releaseTrialXReservation: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PostsService(
      posts as any,
      { getSocialIntegration: jest.fn().mockReturnValue({}) } as any,
      {
        getIntegrationById: jest
          .fn()
          .mockResolvedValue({ providerIdentifier: 'linkedin' }),
      } as any,
      {} as any,
      {
        convertTextToShortLinks: jest.fn().mockResolvedValue(['edited', 'new']),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      subscription as any,
      {} as any,
      {} as any
    );

    await service.createPost(
      'org-1',
      {
        type: 'update',
        date: '2026-09-01T10:00:00',
        tags: [],
        shortLink: false,
        posts: [
          {
            integration: { id: 'channel-1' },
            settings: { __type: 'x-post' },
            value: [
              { id: 'existing-post', content: 'edited', image: [] },
              { content: 'new', image: [] },
            ],
          },
        ],
      } as any,
      'WEB' as any
    );

    expect(subscription.reserveMonthlyPostSlots).toHaveBeenCalledWith(
      'org-1',
      1
    );
  });

  it('releases a monthly reservation when an integration lookup fails before creation', async () => {
    const subscription = {
      reserveMonthlyPostSlots: jest
        .fn()
        .mockResolvedValue('monthly-reservation'),
      releaseMonthlyPostReservation: jest.fn().mockResolvedValue(undefined),
      releaseTrialXReservation: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PostsService(
      {} as any,
      { getSocialIntegration: jest.fn() } as any,
      {
        getIntegrationById: jest
          .fn()
          .mockRejectedValue(new Error('integration unavailable')),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      subscription as any,
      {
        getPublishingState: jest
          .fn()
          .mockResolvedValue({ publishingState: 'ACTIVE' }),
      } as any,
      {} as any
    );

    await expect(
      service.createPost(
        'org-1',
        {
          type: 'schedule',
          date: new Date(Date.now() + 60_000).toISOString(),
          tags: [],
          shortLink: false,
          posts: [
            {
              integration: { id: 'channel-1' },
              value: [{ content: 'one', image: [] }],
              settings: { __type: 'x-post' },
            },
          ],
        } as any,
        'WEB' as any
      )
    ).rejects.toThrow('integration unavailable');

    expect(subscription.releaseMonthlyPostReservation).toHaveBeenCalledWith(
      'monthly-reservation'
    );
  });

  it('reserves a slot before moving a draft to the publish queue', async () => {
    const posts = {
      getPostById: jest.fn().mockResolvedValue({
        id: 'draft-1',
        state: 'DRAFT',
        publishDate: new Date('2026-09-01T10:00:00'),
        integration: { providerIdentifier: 'x-post' },
      }),
      changeState: jest.fn().mockResolvedValue(undefined),
    };
    const subscription = {
      reserveMonthlyPostSlots: jest
        .fn()
        .mockResolvedValue('monthly-reservation'),
      releaseMonthlyPostReservation: jest.fn().mockResolvedValue(undefined),
      releaseTrialXReservation: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PostsService(
      posts as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      subscription as any,
      {
        getPublishingState: jest
          .fn()
          .mockResolvedValue({ publishingState: 'ACTIVE' }),
      } as any,
      {} as any
    );
    (service as any).startWorkflow = jest.fn().mockResolvedValue(undefined);

    await service.changePostStatus('org-1', 'draft-1', 'schedule');

    expect(subscription.reserveMonthlyPostSlots).toHaveBeenCalledWith(
      'org-1',
      1
    );
    expect(posts.changeState).toHaveBeenCalledWith(
      'draft-1',
      'QUEUE',
      undefined,
      undefined,
      'org-1'
    );
    expect(subscription.releaseMonthlyPostReservation).toHaveBeenCalledWith(
      'monthly-reservation'
    );
  });
});
