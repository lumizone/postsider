import { validate } from 'class-validator';
import { TikTokDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { TiktokProvider } from './tiktok.provider';

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

  it('defaults a legacy post without stored privacy_level to PUBLIC_TO_EVERYONE', async () => {
    const provider = new TiktokProvider();
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ data: { publish_id: 'publish-legacy' } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          data: {
            status: 'PUBLISH_COMPLETE',
            publicaly_available_post_id: ['video-legacy'],
          },
        }),
      });
    provider.fetch = fetch;

    await provider.post(
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
    );

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.post_info.privacy_level).toBe('PUBLIC_TO_EVERYONE');
  });

  describe('media classification (MOV/WebM are videos, not photos)', () => {
    it('accepts a single .mov video', async () => {
      const provider = new TiktokProvider();
      await expect(
        provider.checkValidity([
          [{ path: 'https://cdn.example/clip.mov' }],
        ])
      ).resolves.toBe(true);
    });

    it('accepts a single .webm video', async () => {
      const provider = new TiktokProvider();
      await expect(
        provider.checkValidity([
          [{ path: 'https://cdn.example/clip.webm' }],
        ])
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
        provider.checkValidity([
          [{ path: 'https://cdn.example/clip.mkv' }],
        ])
      ).resolves.toContain('MP4, WebM or MOV');
      await expect(
        provider.checkValidity([
          [{ path: 'https://cdn.example/clip.avi' }],
        ])
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
            "Branded content can't be published with Self only visibility",
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
            "Branded content can't be published with Self only visibility",
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
});
