import { Injectable } from '@nestjs/common';
import { LlmConfig, LlmProvider } from '../post-checker.types';

@Injectable()
export class DeepseekCheckProvider implements LlmProvider {
  readonly name = 'deepseek' as const;
  async complete(config: LlmConfig, prompt: string, temperature = 0.3, maxTokens?: number): Promise<string> {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: prompt }], temperature, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
    });
    if (!res.ok) throw new Error(`deepseek ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }
}
