import {
  defaultSettingsFor,
  getProviderRequirement,
  tiktokDisclosureBlocksPublish,
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
    expect(
      requirement.fields.find((field) => field.key === 'video_made_with_ai')
    ).toMatchObject({ showForMedia: 'video', label: 'AI-generated content' });
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
