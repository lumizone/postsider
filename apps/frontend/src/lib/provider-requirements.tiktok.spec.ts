import {
  defaultSettingsFor,
  getProviderRequirement,
  tiktokDisclosureBlocksPublish,
  tiktokCreatorCannotPost,
} from './provider-requirements';

describe('TikTok composer requirements', () => {
  const requirement = getProviderRequirement('tiktok');

  it('defaults to direct posting with every interaction disabled', () => {
    expect(defaultSettingsFor('tiktok')).toMatchObject({
      content_posting_method: 'DIRECT_POST',
      comment: false,
      duet: false,
      stitch: false,
      video_made_with_ai: false,
      brand_content_toggle: false,
      brand_organic_toggle: false,
    });
  });

  it('keeps direct post transport fixed and conditions fields on media', () => {
    expect(
      requirement.fields.find((field) => field.key === 'content_posting_method')
    ).toMatchObject({ hidden: true, defaultValue: 'DIRECT_POST' });
    expect(
      requirement.fields.find((field) => field.key === 'title')
    ).toMatchObject({
      showForMedia: 'photo',
    });
    // AI labelling applies to photo posts too (TikTok takes the flag at the
    // top level of the photo payload), so the control is not video-only.
    expect(
      requirement.fields.find((field) => field.key === 'video_made_with_ai')
    ).toMatchObject({
      showForMedia: 'attached',
      label: 'AI-generated content',
    });
    // Duet and Stitch stay video-only: TikTok's photo post_info has no such
    // fields.
    expect(
      requirement.fields.find((field) => field.key === 'duet')
    ).toMatchObject({ showForMedia: 'video' });
    expect(
      requirement.fields.find((field) => field.key === 'stitch')
    ).toMatchObject({ showForMedia: 'video' });
  });

  it('requires privacy, validates commercial disclosures, and enforces the creator duration limit', () => {
    expect(
      requirement.validate({
        body: 'Caption',
        media: [{ kind: 'video', durationSeconds: 61 }],
        settings: {
          privacy_level: 'SELF_ONLY',
          commercial_content: true,
          brand_content_toggle: true,
        },
        maxVideoDurationSeconds: 60,
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('61 seconds'),
        expect.stringContaining(
          "Branded content can't be published with Self only visibility",
        ),
      ])
    );

    expect(
      requirement.validate({
        body: 'Caption',
        media: [{ kind: 'image' }],
        settings: {
          privacy_level: 'PUBLIC_TO_EVERYONE',
          commercial_content: true,
        },
      })
    ).toContain(
      'Choose the applicable content disclosure before posting to TikTok.'
    );
  });

  it('treats mov/webm as video and rejects unsupported video containers', () => {
    // A .mov attachment is a video, so a second photo next to it is a violation.
    expect(
      requirement.validate({
        body: 'Caption',
        media: [
          { kind: 'video', ext: 'mov' },
          { kind: 'image', ext: 'jpg' },
        ],
        settings: {
          privacy_level: 'PUBLIC_TO_EVERYONE',
          commercial_content: true,
        },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'A video post can only contain one media item'
        ),
      ]),
    );

    // A known-but-unsupported container is explicitly rejected.
    expect(
      requirement.validate({
        body: 'Caption',
        media: [{ kind: 'video', ext: 'mkv' }],
        settings: {
          privacy_level: 'PUBLIC_TO_EVERYONE',
          commercial_content: true,
        },
      })
    ).toContain('TikTok supports video in MP4, WebM or MOV format only.');

    // A .webm is treated as a video (not a photo): mixing it with an image
    // trips the "one media item for video posts" rule instead of passing as
    // a multi-photo carousel.
    expect(
      requirement.validate({
        body: 'Caption',
        media: [
          { kind: 'video', ext: 'webm', durationSeconds: 10 },
          { kind: 'image', ext: 'png' },
        ],
        settings: {
          privacy_level: 'PUBLIC_TO_EVERYONE',
          commercial_content: true,
        },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'A video post can only contain one media item',
        ),
      ]),
    );
  });

  it('enforces the TikTok photo carousel rules (max 35, JPEG/WebP only)', () => {
    const photos = (count: number, ext = 'jpg') =>
      Array.from({ length: count }, () => ({ kind: 'image' as const, ext }));

    const base = { privacy_level: 'PUBLIC_TO_EVERYONE' };

    expect(
      requirement.validate({
        body: 'Caption',
        media: photos(35),
        settings: base,
      })
    ).toEqual([]);

    expect(
      requirement.validate({
        body: 'Caption',
        media: photos(36),
        settings: base,
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('TikTok accepts up to 35 photos'),
      ]),
    );

    expect(
      requirement.validate({
        body: 'Caption',
        media: photos(1, 'gif'),
        settings: base,
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('JPEG or WebP format only'),
      ]),
    );

    expect(
      requirement.validate({
        body: 'Caption',
        media: photos(1, 'webp'),
        settings: base,
      })
    ).toEqual([]);
  });

  it('enforces TikTok resolution rules for video and photos', () => {
    const base = { privacy_level: 'PUBLIC_TO_EVERYONE' };
    const video = (width: number, height: number) => [
      { kind: 'video' as const, ext: 'mp4', durationSeconds: 10, width, height },
    ];

    expect(
      requirement.validate({ body: 'Caption', media: video(300, 300), settings: base })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('between 360 and 4096'),
      ]),
    );

    expect(
      requirement.validate({ body: 'Caption', media: video(1080, 1920), settings: base })
    ).toEqual([]);

    expect(
      requirement.validate({
        body: 'Caption',
        media: [{ kind: 'image' as const, ext: 'jpg', width: 2000, height: 1500 }],
        settings: base,
      })
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('up to 1080p')]),
    );
  });

  it('blocks publishing when disclosure is ON but no type is chosen (TikTok UX 3a)', () => {
    expect(
      tiktokDisclosureBlocksPublish({
        commercial_content: true,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      })
    ).toBe(true);
    expect(
      tiktokDisclosureBlocksPublish({
        commercial_content: true,
        brand_organic_toggle: true,
        brand_content_toggle: false,
      })
    ).toBe(false);
    expect(
      tiktokDisclosureBlocksPublish({
        commercial_content: true,
        brand_content_toggle: true,
        brand_organic_toggle: false,
      })
    ).toBe(false);
    expect(tiktokDisclosureBlocksPublish({})).toBe(false);
  });

  it('blocks publishing when creator_info says the account cannot post (TikTok UX 1b)', () => {
    expect(tiktokCreatorCannotPost({ publishDisabled: true })).toBe(true);
    expect(
      tiktokCreatorCannotPost({ publishDisabled: false, dailyPostLimitRemaining: 0 })
    ).toBe(true);
    expect(
      tiktokCreatorCannotPost({ publishDisabled: false, dailyPostLimitRemaining: 3 })
    ).toBe(false);
    // Field absent from creator_info must not block (undefined ≠ 0).
    expect(tiktokCreatorCannotPost({ publishDisabled: false })).toBe(false);
    expect(tiktokCreatorCannotPost({})).toBe(false);
  });

  it('only Branded content (not Your brand) conflicts with Self only visibility', () => {
    // Your brand + Self only is allowed by TikTok.
    expect(
      requirement.validate({
        body: 'Caption',
        media: [{ kind: 'image' }],
        settings: {
          privacy_level: 'SELF_ONLY',
          commercial_content: true,
          brand_organic_toggle: true,
        },
      }).some((message) => message.includes('Self only visibility'))
    ).toBe(false);

    // Branded content + Self only is rejected.
    expect(
      requirement.validate({
        body: 'Caption',
        media: [{ kind: 'image' }],
        settings: {
          privacy_level: 'SELF_ONLY',
          commercial_content: true,
          brand_content_toggle: true,
        },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Branded content can't be published with Self only visibility",
        ),
      ]),
    );
  });
});
