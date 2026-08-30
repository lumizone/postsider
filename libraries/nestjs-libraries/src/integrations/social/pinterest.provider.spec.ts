import { PinterestProvider } from './pinterest.provider';

describe('PinterestProvider video media', () => {
  const provider = new PinterestProvider();

  it('accepts a cover image before the MP4 video and uploads the video by type', async () => {
    await expect(
      provider.checkValidity([
        [
          { path: 'https://cdn.example/cover.jpg' },
          { path: 'https://cdn.example/clip.mp4' },
        ],
      ])
    ).resolves.toBe(true);
  });

  it('rejects video posts that do not contain exactly one MP4 and one cover image', async () => {
    await expect(
      provider.checkValidity([
        [
          { path: 'https://cdn.example/first.mp4' },
          { path: 'https://cdn.example/cover.jpg' },
          { path: 'https://cdn.example/second.mp4' },
        ],
      ])
    ).resolves.toContain('exactly one MP4 video and one cover image');
  });
});
