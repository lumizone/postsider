import { hasExtension } from './has.extension';

describe('hasExtension', () => {
  it('matches only a terminal extension, ignoring query strings', () => {
    expect(hasExtension('https://cdn.example/clip.mp4?download=1', 'mp4')).toBe(
      true
    );
    expect(hasExtension('https://cdn.example/photo.mp4.jpg', 'mp4')).toBe(
      false
    );
  });
});
