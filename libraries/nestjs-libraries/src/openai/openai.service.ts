import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
});

@Injectable()
export class OpenaiService {
  // Generic single-prompt completion used by our data-driven AI helpers
  // (Post Checker, caption rewrite). Returns raw text; callers parse it.
  async complete(prompt: string, model = 'gpt-4.1'): Promise<string> {
    const res = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices[0]?.message?.content || '';
  }
}
