export type CheckProvider = 'openai' | 'deepseek' | 'gemini';

export interface LlmConfig {
  provider: CheckProvider;
  model: string;
  apiKey: string;
}

export interface CheckInput {
  content: string;
  hasMedia: boolean;
  mediaType?: 'image' | 'video' | 'mixed';
  platform: string; // providerIdentifier, e.g. "x", "linkedin", "instagram"
}

export interface CheckResult {
  score: number; // 0-100
  dimensions: { hook: number; clarity: number; cta: number; platformFit: number };
  positives: string[];
  negatives: string[];
}

export interface LlmProvider {
  readonly name: CheckProvider;
  complete(config: LlmConfig, prompt: string): Promise<string>;
}
