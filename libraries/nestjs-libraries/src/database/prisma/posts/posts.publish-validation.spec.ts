jest.mock('isomorphic-dompurify', () => ({
  sanitize: (value: string) => value,
}));

import { PostsService } from './posts.service';
import { TiktokProvider } from '@postsider/nestjs-libraries/integrations/social/tiktok.provider';

/**
 * Drafts skip the TikTok settings DTO and media rules at creation time (that is
 * deliberate — a half-written draft must be saveable), so arming one for
 * publishing has to re-check them. The publish-time creator_info gate lives in
 * the provider; this covers the offline gate in front of the queue.
 */
describe('TikTok queue-time validation', () => {
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

  const build = (options: {
    settings?: Record<string, unknown>;
    image?: any[];
    state?: string;
    providerIdentifier?: string;
  }) => {
    const providerIdentifier = options.providerIdentifier ?? 'tiktok';
    const provider = new TiktokProvider();

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

    const service = new PostsService(
      posts as any,
      { getSocialIntegration: jest.fn().mockReturnValue(provider) } as any,
      {} as any,
      {
        getMediaById: jest.fn().mockResolvedValue({
          id: 'media-1',
          width: 1080,
          height: 1080,
          durationSeconds: undefined,
        }),
      } as any,
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

    return { service, posts };
  };

  it('refuses to queue a TikTok draft without a privacy level', async () => {
    const { service, posts } = build({
      settings: { ...fullSettings, privacy_level: undefined },
    });

    await expect(
      service.changePostStatus('org-1', 'post-1', 'schedule')
    ).rejects.toThrow('Choose who can see this post on TikTok');
    expect(posts.changeState).not.toHaveBeenCalled();
  });

  it('refuses a TikTok draft whose photo count exceeds the API limit', async () => {
    const { service } = build({
      image: Array.from({ length: 36 }, (_, i) => ({
        id: `media-${i}`,
        path: `https://cdn.example/p-${i}.jpg`,
      })),
    });

    await expect(
      service.changePostStatus('org-1', 'post-1', 'schedule')
    ).rejects.toThrow('up to 35 photos');
  });

  it('queues a valid TikTok draft', async () => {
    const { service, posts } = build({});

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

  it('leaves other providers untouched', async () => {
    const { service, posts } = build({ providerIdentifier: 'x-post' });

    await expect(
      service.changePostStatus('org-1', 'post-1', 'schedule')
    ).resolves.toEqual({ id: 'post-1', state: 'QUEUE' });
    expect(posts.changeState).toHaveBeenCalled();
  });
});
