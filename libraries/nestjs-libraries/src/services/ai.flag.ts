import type { CheckProvider } from '@postsider/nestjs-libraries/post-checker/post-checker.types';

const PLATFORM_PROVIDERS: CheckProvider[] = ['openai', 'deepseek', 'gemini'];

export interface PlatformAiConfig {
  provider: CheckProvider;
  model: string;
  apiKey: string;
}

// Cloud uses one platform-owned provider credential. Self-host deployments
// without it retain their existing per-organization BYO-key behavior.
export function getPlatformAiConfig(): PlatformAiConfig | null {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  if (!PLATFORM_PROVIDERS.includes(provider as CheckProvider)) {
    throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  }

  const defaults: Record<CheckProvider, string> = {
    openai: 'gpt-4.1',
    deepseek: 'deepseek-chat',
    gemini: 'gemini-2.5-flash',
  };
  return {
    provider: provider as CheckProvider,
    model: process.env.AI_MODEL || defaults[provider as CheckProvider],
    apiKey,
  };
}

export function isPlatformAiEnabled(): boolean {
  return !!getPlatformAiConfig();
}
