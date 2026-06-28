import { Injectable } from '@nestjs/common';
import { LlmConfig, LlmProvider } from '../post-checker.types';

@Injectable()
export class DeepseekCheckProvider implements LlmProvider {
  readonly name = 'deepseek' as const;
  async complete(config: LlmConfig, prompt: string): Promise<string> {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: prompt }], temperature: 0.3 }),
    });
    if (!res.ok) throw new Error(`deepseek ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }
}
