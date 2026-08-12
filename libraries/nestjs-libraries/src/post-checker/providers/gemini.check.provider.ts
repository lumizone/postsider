import { Injectable } from '@nestjs/common';
import { LlmConfig, LlmProvider } from '../post-checker.types';

@Injectable()
export class GeminiCheckProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  async complete(config: LlmConfig, prompt: string, temperature = 0.3): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${config.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, responseMimeType: 'application/json' } }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }
}
