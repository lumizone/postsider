import { buildCheckPrompt } from './post-checker.prompt';

describe('buildCheckPrompt', () => {
  it('includes the content, platform, and a strict JSON instruction', () => {
    const p = buildCheckPrompt({ content: 'Launch tomorrow 🚀', hasMedia: false, platform: 'x' });
    expect(p).toContain('Launch tomorrow 🚀');
    expect(p).toContain('x');
    expect(p).toMatch(/JSON/i);
    expect(p).toContain('"score"');
  });
  it('mentions media when present', () => {
    const p = buildCheckPrompt({ content: 'hi', hasMedia: true, mediaType: 'video', platform: 'instagram' });
    expect(p).toMatch(/video/i);
  });
});
