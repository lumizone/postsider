jest.mock('isomorphic-dompurify', () => ({
  sanitize: (value: string) => value,
}));

import { PostsService } from './posts.service';
import { TiktokProvider } from '@postsider/nestjs-libraries/integrations/social/tiktok.provider';

/**
 * Direct Post compliance is only guaranteed if it is enforced at the moment of
 * publishing, because drafts, approvals, the public API, duplicates and
 * evergreen all arm the queue without going through the composer. These tests
 * pin that gate (and the draft -> schedule gate in front of it).
 */
describe('TikTok publish-time validation', () => {
  const fullSettings = {
    privacy_level: 'PUBLIC_TO_EVERYONE',
    duet: false,
    stitch: false,
    comment: false,
    autoAddMusic: 'no',
    brand_content_toggle: false,
    brand_organic_toggle: false,
    content_posting_method: 'DIRECT_POST',
  };

  const creatorOk = {
    creator_nickname: 'Creator',
    creator_username: 'creator',
    privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
    comment_disabled: false,
    duet_disabled: false,
    stitch_disabled: false,
    max_video_post_duration_sec: 600,
  };

  const build = (options: {
    settings?: Record<string, unknown>;
    image?: any[];
    provider?: TiktokProvider;
    state?: string;
    providerIdentifier?: string;
    creatorResponse?: any;
  }) => {
    const providerIdentifier = options.providerIdentifier ?? 'tiktok';
    const provider = options.provider ?? new TiktokProvider();
    if (options.creatorResponse) {
      (provider as any).fetch = jest.fn().mockResolvedValue({
        json: async () => options.creatorResponse,
      });
    }

    const posts = {
      getPost: jest.fn().mockResolvedValue({
        id: 'post-1',
        settings: JSON.stringify(options.settings ?? fullSettings),
        image: JSON.stringify(
          options.image ?? [{ id: 'media-1', path: 'https://cdn.example/a.jpg' }]
        ),
        state: options.state ?? 'QUEUE',
        childrenPost: [],
        integration: {
          id: 'int-1',
          providerIdentifier,
          token: 'token',
          additionalSettings: '[]',
        },
      }),
      getPostById: jest.fn().mockResolvedValue({
        id: 'post-1',
        state: options.state ?? 'DRAFT',
        settings: JSON.stringify(options.settings ?? fullSettings),
        image: JSON.stringify(
          options.image ?? [{ id: 'media-1', path: 'https://cdn.example/a.jpg' }]
        ),
        integration: { providerIdentifier, token: 'token' },
      }),
      changeState: jest.fn().mockResolvedValue(undefined),
      updateImages: jest.fn().mockResolvedValue(undefined),
    };

    const integrationManager = {
      getSocialIntegration: jest.fn().mockReturnValue(provider),
    };

    const media = {
      getMediaById: jest.fn().mockResolvedValue({
        id: 'media-1',
        width: 1080,
        height: 1080,
        durationSeconds: undefined,
      }),
    };

    const service = new PostsService(
      posts as any,
      integrationManager as any,
      {} as any,
      media as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        reserveMonthlyPostSlots: jest.fn().mockResolvedValue('reservation'),
        releaseMonthlyPostReservation: jest.fn().mockResolvedValue(undefined),
      } as any,
      {
        getPublishingState: jest
          .fn()
          .mockResolvedValue({ publishingState: 'ACTIVE' }),
      } as any,
      {} as any
    );
    (service as any).startWorkflow = jest.fn().mockResolvedValue(undefined);

    return { service, posts, provider, integrationManager, media };
  };

  it('passes a fully valid TikTok post', async () => {
    const { service } = build({
      creatorResponse: { error: { code: 'ok' }, data: creatorOk },
    });

    await expect(
      service.validatePostAtPublish('org-1', 'post-1')
    ).resolves.toBeUndefined();
  });

  it('rejects a post without a privacy level', async () => {
    const { service } = build({
      settings: { ...fullSettings, privacy_level: undefined },
      creatorResponse: { error: { code: 'ok' }, data: creatorOk },
    });

    await expect(
      service.validatePostAtPublish('org-1', 'post-1')
    ).rejects.toThrow('Choose who can see this post on TikTok');
  });

  it('fails closed when creator_info cannot be read', async () => {
    const { service } = build({
      creatorResponse: {
        error: { code: 'access_token_invalid', message: 'expired' },
      },
    });

    await expect(
      service.validatePostAtPublish('org-1', 'post-1')
    ).rejects.toThrow(/creator information/i);
  });

  it('reports a rejected post as a non-retryable bad body so it fails fast', async () => {
    const { service } = build({
      settings: { ...fullSettings, privacy_level: undefined },
    });

    await expect(
      service.validatePostAtPublish('org-1', 'post-1')
    ).rejects.toMatchObject({ type: 'bad_body', nonRetryable: true });
  });

  it('rejects a privacy level the creator is not allowed to use', async () => {
    const { service } = build({
      settings: { ...fullSettings, privacy_level: 'SELF_ONLY' },
      creatorResponse: {
        error: { code: 'ok' },
        data: { ...creatorOk, privacy_level_options: ['PUBLIC_TO_EVERYONE'] },
      },
    });

    await expect(
      service.validatePostAtPublish('org-1', 'post-1')
    ).rejects.toThrow(/does not allow the chosen privacy level/i);
  });

  it('rejects a disclosure that is on with no type selected', async () => {
    const { service } = build({
      settings: { ...fullSettings, commercial_content: true },
      creatorResponse: { error: { code: 'ok' }, data: creatorOk },
    });

    await expect(
      service.validatePostAtPublish('org-1', 'post-1')
    ).rejects.toThrow(/content disclosure/i);
  });

  it('rejects more than 35 photos', async () => {
    const { service } = build({
      image: Array.from({ length: 36 }, (_, i) => ({
        id: `media-${i}`,
        path: `https://cdn.example/p-${i}.jpg`,
      })),
      creatorResponse: { error: { code: 'ok' }, data: creatorOk },
    });

    await expect(
      service.validatePostAtPublish('org-1', 'post-1')
    ).rejects.toThrow(/35 photos/i);
  });

  it('leaves other providers untouched', async () => {
    const { service, integrationManager } = build({
      providerIdentifier: 'x-post',
    });

    await expect(
      service.validatePostAtPublish('org-1', 'post-1')
    ).resolves.toBeUndefined();
    expect(integrationManager.getSocialIntegration).not.toHaveBeenCalled();
  });

  it('refuses to queue an invalid TikTok draft for publishing', async () => {
    const { service, posts } = build({
      settings: { ...fullSettings, privacy_level: undefined },
      state: 'DRAFT',
    });

    await expect(
      service.changePostStatus('org-1', 'post-1', 'schedule')
    ).rejects.toThrow('Choose who can see this post on TikTok');
    expect(posts.changeState).not.toHaveBeenCalled();
  });

  it('queues a valid TikTok draft', async () => {
    const { service, posts } = build({ state: 'DRAFT' });

    await expect(
      service.changePostStatus('org-1', 'post-1', 'schedule')
    ).resolves.toEqual({ id: 'post-1', state: 'QUEUE' });
    expect(posts.changeState).toHaveBeenCalled();
  });

  it('refuses to schedule an invalid TikTok draft from the calendar', async () => {
    const { service } = build({
      settings: { ...fullSettings, privacy_level: undefined },
      state: 'DRAFT',
    });

    await expect(
      service.changeDate('org-1', 'post-1', '2026-09-01T10:00:00', 'schedule')
    ).rejects.toThrow('Choose who can see this post on TikTok');
  });
});
