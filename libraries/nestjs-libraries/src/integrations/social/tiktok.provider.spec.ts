import { validate } from 'class-validator';
import { TikTokDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { isTikTokPullableUrl, TiktokProvider } from './tiktok.provider';

/** A complete, creator-approved TikTok settings object. */
const baseSettings: any = {
  privacy_level: 'PUBLIC_TO_EVERYONE',
  duet: false,
  stitch: false,
  comment: false,
  autoAddMusic: 'no',
  brand_content_toggle: false,
  brand_organic_toggle: false,
  content_posting_method: 'DIRECT_POST',
};

describe('TiktokProvider Direct Post', () => {
  it('rejects the inbox upload transport at DTO validation', async () => {
    const dto = Object.assign(new TikTokDto(), {
      privacy_level: 'PUBLIC_TO_EVERYONE',
      duet: false,
      stitch: false,
      comment: false,
      autoAddMusic: 'no',
      brand_content_toggle: false,
      brand_organic_toggle: false,
      content_posting_method: 'UPLOAD',
    });

    const errors = await validate(dto);

    expect(
      errors.find((error) => error.property === 'content_posting_method')
    ).toBeDefined();
  });

  it('always initializes a direct video post even if an old payload says upload', async () => {
    const provider = new TiktokProvider();
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ data: { publish_id: 'publish-1' } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          data: {
            status: 'PUBLISH_COMPLETE',
            publicaly_available_post_id: ['video-1'],
          },
        }),
      });
    provider.fetch = fetch;

    await provider.post(
      'post-1',
      'token',
      [
        {
          id: 'post-1',
          message: 'Caption',
          media: [{ path: 'https://cdn.example/video.mp4' }],
          settings: {
            privacy_level: 'PUBLIC_TO_EVERYONE',
            duet: false,
            stitch: false,
            comment: false,
            autoAddMusic: 'no',
            brand_content_toggle: false,
            brand_organic_toggle: false,
            content_posting_method: 'UPLOAD',
          },
        },
      ] as any,
      { profile: 'creator' } as any
    );

    expect(fetch.mock.calls[0][0]).toContain('/v2/post/publish/video/init/');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      post_info: { privacy_level: 'PUBLIC_TO_EVERYONE' },
    });
  });

  it('does not report an inbox handoff as a published post', async () => {
    const provider = new TiktokProvider() as any;
    provider.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { status: 'SEND_TO_USER_INBOX' } }),
    });

    await expect(
      provider.uploadedVideoSuccess('creator', 'publish-1', 'token')
    ).rejects.toThrow('instead of publishing it directly');
  });

  it('keeps account analytics when video.list is unavailable', async () => {
    const provider = new TiktokProvider();
    const logError = jest.spyOn(console, 'error').mockImplementation();
    provider.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          data: {
            user: {
              follower_count: 12,
              following_count: 3,
              likes_count: 45,
              video_count: 6,
            },
          },
        }),
      })
      .mockRejectedValueOnce(new Error('video.list scope not granted'));

    const analytics = await provider.analytics('creator', 'token', 30);

    expect(analytics.map((entry) => entry.label)).toEqual([
      'Followers',
      'Following',
      'Total Likes',
      'Videos',
    ]);
    expect(logError).toHaveBeenCalledWith(
      'Error fetching TikTok video analytics:',
      expect.any(Error)
    );
    logError.mockRestore();
  });

  it('refuses to publish a post that has no privacy_level instead of guessing one', async () => {
    const provider = new TiktokProvider();
    const fetch = jest.fn();
    provider.fetch = fetch;

    await expect(
      provider.post(
        'post-legacy',
        'token',
        [
          {
            id: 'post-legacy',
            message: 'Legacy caption',
            media: [{ path: 'https://cdn.example/legacy.mp4' }],
            settings: {
              duet: false,
              stitch: false,
              comment: false,
              autoAddMusic: 'no',
              brand_content_toggle: false,
              brand_organic_toggle: false,
            },
          },
        ] as any,
        { profile: 'creator' } as any
      )
    ).rejects.toThrow('Choose who can see this post on TikTok');

    // Nothing may reach TikTok when the creator never chose a privacy level.
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('media classification (MOV/WebM are videos, not photos)', () => {
    it('accepts a single .mov video', async () => {
      const provider = new TiktokProvider();
      await expect(
        provider.checkValidity([[{ path: 'https://cdn.example/clip.mov' }]])
      ).resolves.toBe(true);
    });

    it('accepts a single .webm video', async () => {
      const provider = new TiktokProvider();
      await expect(
        provider.checkValidity([[{ path: 'https://cdn.example/clip.webm' }]])
      ).resolves.toBe(true);
    });

    it('rejects a mix of a .mov video with photos', async () => {
      const provider = new TiktokProvider();
      await expect(
        provider.checkValidity([
          [
            { path: 'https://cdn.example/clip.mov' },
            { path: 'https://cdn.example/photo.jpg' },
          ],
        ])
      ).resolves.toContain('Only pictures are supported');
    });

    it('explicitly rejects known unsupported video containers', async () => {
      const provider = new TiktokProvider();
      await expect(
        provider.checkValidity([[{ path: 'https://cdn.example/clip.mkv' }]])
      ).resolves.toContain('MP4, WebM or MOV');
      await expect(
        provider.checkValidity([[{ path: 'https://cdn.example/clip.avi' }]])
      ).resolves.toContain('MP4, WebM or MOV');
    });

    it('routes a .mov video to the video init endpoint (not photo)', async () => {
      const provider = new TiktokProvider();
      const fetch = jest
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({ data: { publish_id: 'publish-2' } }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            data: {
              status: 'PUBLISH_COMPLETE',
              publicaly_available_post_id: ['video-2'],
            },
          }),
        });
      provider.fetch = fetch;

      await provider.post(
        'post-2',
        'token',
        [
          {
            id: 'post-2',
            message: 'Caption',
            media: [{ path: 'https://cdn.example/clip.mov' }],
            settings: {
              privacy_level: 'PUBLIC_TO_EVERYONE',
              duet: false,
              stitch: false,
              comment: false,
              autoAddMusic: 'no',
              brand_content_toggle: false,
              brand_organic_toggle: false,
              content_posting_method: 'DIRECT_POST',
            },
          },
        ] as any,
        { profile: 'creator' } as any
      );

      expect(fetch.mock.calls[0][0]).toContain('/v2/post/publish/video/init/');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.post_info.title).toBe('Caption');
      expect(body.source_info).toMatchObject({
        source: 'PULL_FROM_URL',
        video_url: 'https://cdn.example/clip.mov',
      });
    });
  });

  describe('creator-derived rules (server-side best effort)', () => {
    it('rejects a privacy level the creator cannot use', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          {
            privacyOptions: ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR'],
          },
          { ...baseSettings, privacy_level: 'SELF_ONLY' } as any,
          []
        )
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('does not allow the chosen privacy level'),
        ])
      );
    });

    it('honours creator interaction locks', () => {
      const provider = new TiktokProvider();
      const issues = provider.validateCreatorRules(
        {
          duetDisabled: true,
          stitchDisabled: true,
          commentDisabled: true,
        },
        {
          ...baseSettings,
          duet: true,
          stitch: true,
          comment: true,
        } as any,
        []
      );
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Duet is turned off'),
          expect.stringContaining('Stitch is turned off'),
          expect.stringContaining('Comments are turned off'),
        ])
      );
    });

    it('rejects Branded content visible only to the creator', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] },
          {
            ...baseSettings,
            privacy_level: 'SELF_ONLY',
            brand_content_toggle: true,
          } as any,
          []
        )
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "Branded content can't be published with Self only visibility"
          ),
        ])
      );
    });

    it('allows Your brand with Self only visibility', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] },
          {
            ...baseSettings,
            privacy_level: 'SELF_ONLY',
            brand_organic_toggle: true,
          } as any,
          []
        )
      ).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "Branded content can't be published with Self only visibility"
          ),
        ])
      );
    });

    it('rejects a video longer than the creator limit', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { maxDurationSeconds: 60 },
          baseSettings,
          [{ path: 'clip.mp4', durationSeconds: 61 }]
        )
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('61 seconds long'),
          expect.stringContaining('up to 60 seconds'),
        ])
      );
    });

    it('blocks publishing when creator_info reports the account cannot post', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { publishDisabled: true },
          baseSettings,
          []
        )
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('cannot publish right now'),
        ])
      );
    });

    it('blocks publishing when the daily post quota is exhausted', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { dailyPostLimitRemaining: 0 },
          baseSettings,
          []
        )
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('daily post limit'),
        ])
      );
    });

    it('does not block on a missing daily quota (field absent from creator_info)', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE'] },
          baseSettings,
          []
        )
      ).toEqual([]);
    });

    it('passes a conforming post', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          {
            privacyOptions: ['PUBLIC_TO_EVERYONE'],
            maxDurationSeconds: 60,
          },
          baseSettings,
          [{ path: 'clip.mp4', durationSeconds: 30 }]
        )
      ).toEqual([]);
    });
  });

  describe('photo post limits (Content Posting API)', () => {
    it('accepts 35 photos and rejects 36', async () => {
      const provider = new TiktokProvider();
      const photos = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
          path: `https://cdn.example/photo-${i}.jpg`,
        }));

      await expect(provider.checkValidity([photos(35)])).resolves.toBe(true);
      await expect(provider.checkValidity([photos(36)])).resolves.toContain(
        'up to 35 photos'
      );
    });

    it('rejects image containers TikTok cannot post (gif, avif, tiff)', async () => {
      const provider = new TiktokProvider();
      for (const ext of ['gif', 'avif', 'tiff']) {
        await expect(
          provider.checkValidity([[{ path: `https://cdn.example/a.${ext}` }]])
        ).resolves.toContain('JPEG or WebP');
      }
    });

    it('accepts JPEG, PNG (converted before upload) and WebP', async () => {
      const provider = new TiktokProvider();
      for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
        await expect(
          provider.checkValidity([[{ path: `https://cdn.example/a.${ext}` }]])
        ).resolves.toBe(true);
      }
    });

    it('rejects a photo larger than 1080p using the stored dimensions', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE'] },
          { ...baseSettings, brand_content_toggle: false } as any,
          [{ path: 'https://cdn.example/big.png', width: 2000, height: 2000 }]
        )
      ).toEqual(
        expect.arrayContaining([expect.stringContaining('up to 1080p')])
      );
    });

    it('rejects a video outside the 360–4096 pixel range', () => {
      const provider = new TiktokProvider();
      const rules = (width: number, height: number) =>
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE'], maxDurationSeconds: 600 },
          baseSettings,
          [{ path: 'https://cdn.example/clip.mp4', width, height }]
        );

      expect(rules(300, 300)).toEqual(
        expect.arrayContaining([expect.stringContaining('between 360 and 4096')])
      );
      expect(rules(5000, 1080)).toEqual(
        expect.arrayContaining([expect.stringContaining('between 360 and 4096')])
      );
      expect(rules(1080, 1920)).toEqual([]);
      expect(rules(360, 360)).toEqual([]);
      expect(rules(4096, 2160)).toEqual([]);
    });

    it('does not block a video whose dimensions are unknown', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE'], maxDurationSeconds: 600 },
          baseSettings,
          [{ path: 'https://cdn.example/clip.mp4' }]
        )
      ).toEqual([]);
    });

    it('accepts a photo at exactly 1080p', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE'] },
          baseSettings,
          [{ path: 'https://cdn.example/ok.jpg', width: 1080, height: 1080 }]
        )
      ).toEqual([]);
    });
  });

  describe('privacy and disclosure enforcement', () => {
    it('requires a privacy level to be chosen', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE'] },
          { ...baseSettings, privacy_level: undefined } as any,
          []
        )
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Choose who can see this post on TikTok'),
        ])
      );
    });

    it('blocks when creator_info returned no privacy options', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: [] },
          baseSettings,
          []
        )
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('did not return the allowed privacy levels'),
        ])
      );
    });

    it('blocks a disclosure that is switched on with no type selected', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE'] },
          { ...baseSettings, commercial_content: true } as any,
          []
        )
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Choose the applicable content disclosure before posting to TikTok'
          ),
        ])
      );
    });

    it('allows the disclosure once a type is selected', () => {
      const provider = new TiktokProvider();
      expect(
        provider.validateCreatorRules(
          { privacyOptions: ['PUBLIC_TO_EVERYONE'] },
          {
            ...baseSettings,
            commercial_content: true,
            brand_organic_toggle: true,
          } as any,
          []
        )
      ).toEqual([]);
    });
  });

  describe('AI-generated flag', () => {
    it('sends is_aigc for a photo post at the top level', async () => {
      const provider = new TiktokProvider();
      const fetch = jest
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({ data: { publish_id: 'publish-photo' } }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            data: {
              status: 'PUBLISH_COMPLETE',
              publicaly_available_post_id: [],
            },
          }),
        });
      provider.fetch = fetch;

      await provider.post(
        'post-photo',
        'token',
        [
          {
            id: 'post-photo',
            message: 'Caption',
            media: [{ path: 'https://cdn.example/a.jpg' }],
            settings: { ...baseSettings, video_made_with_ai: true },
          },
        ] as any,
        { profile: 'creator' } as any
      );

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.post_mode).toBe('DIRECT_POST');
      expect(body.media_type).toBe('PHOTO');
      expect(body.is_aigc).toBe(true);
      // Photos have no post_info.is_aigc field.
      expect(body.post_info.is_aigc).toBeUndefined();
    });

    it('keeps is_aigc inside post_info for a video post', async () => {
      const provider = new TiktokProvider();
      const fetch = jest
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({ data: { publish_id: 'publish-video' } }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            data: {
              status: 'PUBLISH_COMPLETE',
              publicaly_available_post_id: ['video-1'],
            },
          }),
        });
      provider.fetch = fetch;

      await provider.post(
        'post-video',
        'token',
        [
          {
            id: 'post-video',
            message: 'Caption',
            media: [{ path: 'https://cdn.example/a.mp4' }],
            settings: { ...baseSettings, video_made_with_ai: true },
          },
        ] as any,
        { profile: 'creator' } as any
      );

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.post_info.is_aigc).toBe(true);
      expect(body.is_aigc).toBeUndefined();
    });
  });

  describe('posting caps (guideline 1b)', () => {
    it('explains the unaudited restriction instead of blaming the account', () => {
      const provider = new TiktokProvider();

      expect(
        provider.handleErrors(
          '{"error":{"code":"unaudited_client_can_only_post_to_private_accounts"}}'
        )
      ).toMatchObject({
        type: 'bad-body',
        value: expect.stringContaining('must be set to private'),
      });
    });

    it('treats a revoked authorization as a reconnect prompt, not a retry', () => {
      const provider = new TiktokProvider();

      expect(provider.handleErrors('{"fail_reason":"auth_removed"}')).toMatchObject(
        {
          type: 'bad-body',
          value: expect.stringContaining('reconnect'),
        }
      );
    });

    it('maps a platform-side posting block to a retry-later prompt', () => {
      const provider = new TiktokProvider();

      expect(
        provider.handleErrors('{"error":{"code":"post_publish_disabled"}}')
      ).toMatchObject({
        type: 'bad-body',
        value: expect.stringContaining('Please try again later'),
      });
      expect(
        provider.handleErrors('{"error":{"code":"daily_post_limit_reached"}}')
      ).toMatchObject({
        type: 'bad-body',
        value: expect.stringContaining('Please try again later'),
      });
    });
  });

  describe('creator_info error handling', () => {
    it('fails when TikTok answers with an error code instead of data', async () => {
      const provider = new TiktokProvider();
      provider.fetch = jest.fn().mockResolvedValue({
        json: async () => ({
          error: { code: 'access_token_invalid', message: 'token expired' },
        }),
      });

      await expect(provider.creatorInfo('token')).rejects.toThrow(
        'TikTok did not return the creator information'
      );
    });

    it('fails when TikTok answers ok but without data', async () => {
      const provider = new TiktokProvider();
      provider.fetch = jest.fn().mockResolvedValue({
        json: async () => ({ error: { code: 'ok', message: '' } }),
      });

      await expect(provider.creatorInfo('token')).rejects.toThrow();
    });

    it('reports a missing scope as a reconnect problem', async () => {
      const provider = new TiktokProvider();
      provider.fetch = jest.fn().mockResolvedValue({
        json: async () => ({
          error: { code: 'scope_not_authorized', message: 'no scope' },
        }),
      });

      await expect(provider.creatorInfo('token')).rejects.toThrow(
        're-authenticate'
      );
    });
  });

  describe('PULL_FROM_URL requirements', () => {
    const settings = { ...baseSettings, privacy_level: 'SELF_ONLY' };

    it('blocks an http media URL before calling TikTok', async () => {
      const provider = new TiktokProvider();
      const fetch = jest.fn();
      provider.fetch = fetch;

      await expect(
        provider.post(
          'post-1',
          'token',
          [
            {
              id: 'post-1',
              message: 'x',
              media: [{ path: 'http://cdn.example/clip.mp4' }],
              settings,
            },
          ] as any,
          { profile: 'creator' } as any
        )
      ).rejects.toThrow('public https URL');

      expect(fetch).not.toHaveBeenCalled();
    });

    it('blocks a URL outside the configured verified prefix', async () => {
      process.env.TIKTOK_VERIFIED_MEDIA_PREFIX =
        'https://cdn.postsider.com/media';
      try {
        const provider = new TiktokProvider();
        const fetch = jest.fn();
        provider.fetch = fetch;

        await expect(
          provider.post(
            'post-1',
            'token',
            [
              {
                id: 'post-1',
                message: 'x',
                media: [{ path: 'https://evil.example/clip.mp4' }],
                settings,
              },
            ] as any,
            { profile: 'creator' } as any
          )
        ).rejects.toThrow('public https URL');

        expect(fetch).not.toHaveBeenCalled();
      } finally {
        delete process.env.TIKTOK_VERIFIED_MEDIA_PREFIX;
      }
    });

    it('rejects more than 35 photos before calling TikTok', async () => {
      const provider = new TiktokProvider();
      const fetch = jest.fn();
      provider.fetch = fetch;

      await expect(
        provider.post(
          'post-1',
          'token',
          [
            {
              id: 'post-1',
              message: 'x',
              media: Array.from({ length: 36 }, (_, i) => ({
                path: `https://cdn.example/p-${i}.jpg`,
              })),
              settings,
            },
          ] as any,
          { profile: 'creator' } as any
        )
      ).rejects.toThrow('up to 35 photos');

      expect(fetch).not.toHaveBeenCalled();
    });

    it('accepts only https URLs under the configured prefix', () => {
      process.env.TIKTOK_VERIFIED_MEDIA_PREFIX = 'https://cdn.postsider.com/media';
      try {
        expect(
          isTikTokPullableUrl('https://cdn.postsider.com/media/a/b.mp4')
        ).toBe(true);
        expect(isTikTokPullableUrl('http://cdn.postsider.com/media/a.mp4')).toBe(
          false
        );
        expect(isTikTokPullableUrl('https://cdn.postsider.com/other/a.mp4')).toBe(
          false
        );
        expect(isTikTokPullableUrl('https://cdn.postsider.com.evil.io/a.mp4')).toBe(
          false
        );
      } finally {
        delete process.env.TIKTOK_VERIFIED_MEDIA_PREFIX;
      }
    });
  });
});
