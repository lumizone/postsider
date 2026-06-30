import { isPlatformAiEnabled } from './ai.flag';

describe('isPlatformAiEnabled', () => {
  const old = process.env.OPENAI_API_KEY;
  afterEach(() => { process.env.OPENAI_API_KEY = old; });

  it('is true when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isPlatformAiEnabled()).toBe(true);
  });

  it('is false when OPENAI_API_KEY is empty/unset', () => {
    delete process.env.OPENAI_API_KEY;
    expect(isPlatformAiEnabled()).toBe(false);
    process.env.OPENAI_API_KEY = '';
    expect(isPlatformAiEnabled()).toBe(false);
  });
});
