import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

// Lazy: self-host deployments without OPENAI_API_KEY must still boot (the
// service is only used when platform AI is enabled). A call without a key
// fails fast with a clear error instead of an opaque auth failure from a
// bogus 'sk-proj-' fallback.
let openai: OpenAI | null = null;
function getClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

@Injectable()
export class OpenaiService {
  // Generic single-prompt completion used by our data-driven AI helpers
  // (Post Checker, caption rewrite). Returns raw text; callers parse it.
  async complete(
    prompt: string,
    model = 'gpt-4.1',
    temperature = 0.3
  ): Promise<string> {
    const res = await getClient().chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      response_format: { type: 'json_object' },
    });
    return res.choices[0]?.message?.content || '';
  }
}
