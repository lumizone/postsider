import { buildRewritePrompt } from './rewrite.prompt';

describe('buildRewritePrompt', () => {
  it('preserves language and original facts', () => {
    const prompt = buildRewritePrompt({ content: 'Premiera jutro o 10:00', tone: 'punchy', platform: 'linkedin' });
    expect(prompt).toContain('Keep the original language');
    expect(prompt).toContain('Do not add hashtags');
    expect(prompt).toContain('linkedin');
  });
});
