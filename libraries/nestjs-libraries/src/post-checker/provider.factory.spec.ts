import { pickProvider } from './provider.factory';

const fake = (name: string) => ({ name, complete: async () => '' }) as any;

describe('pickProvider', () => {
  const providers = [fake('openai'), fake('deepseek'), fake('gemini')];
  it('returns the provider matching the name', () => {
    expect(pickProvider(providers, 'gemini').name).toBe('gemini');
  });
  it('throws on an unknown provider', () => {
    expect(() => pickProvider(providers, 'mistral' as any)).toThrow();
  });
});
