import { getPlatformAiConfig, isPlatformAiEnabled } from './ai.flag';

describe('isPlatformAiEnabled', () => {
  const old = {
    openai: process.env.OPENAI_API_KEY,
    provider: process.env.AI_PROVIDER,
    key: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
  };
  afterEach(() => {
    process.env.OPENAI_API_KEY = old.openai;
    process.env.AI_PROVIDER = old.provider;
    process.env.AI_API_KEY = old.key;
    process.env.AI_MODEL = old.model;
  });

  it('is true when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isPlatformAiEnabled()).toBe(true);
  });

  it('is false when OPENAI_API_KEY is empty/unset', () => {
    delete process.env.AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(isPlatformAiEnabled()).toBe(false);
    process.env.OPENAI_API_KEY = '';
    expect(isPlatformAiEnabled()).toBe(false);
  });

  it('uses the configured cloud provider and model', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_API_KEY = 'deepseek-key';
    process.env.AI_PROVIDER = 'deepseek';
    process.env.AI_MODEL = 'deepseek-v4-flash';
    expect(getPlatformAiConfig()).toEqual({
      apiKey: 'deepseek-key',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    });
  });
});
