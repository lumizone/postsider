import { RewriteInput } from './rewrite.types';

const TONE: Record<string, string> = {
  rephrase: 'Keep the same length and meaning but use different wording',
  shorten: 'Reduce to 60% or fewer characters while keeping the core point',
  formal: 'Professional and polished, suitable for LinkedIn',
  casual: 'Conversational and friendly, lower energy',
  punchy: 'High energy, short sentences, a stronger hook',
};

export function buildRewritePrompt(input: RewriteInput): string {
  const count = Math.max(1, Math.min(5, input.count ?? 3));
  const tone = TONE[input.tone ?? 'rephrase'] ?? TONE.rephrase;
  const platform = input.platform
    ? `Platform context: "${input.platform}". Match its norms.\n`
    : '';

  return `You are a social media copywriter improving captions.
Rewrite the caption below into ${count} distinct variations.
Tone: ${tone}.
${platform}
ORIGINAL CAPTION:
"""
${input.content}
"""

Rules:
- Each variation must be self-contained and ready to post.
- Preserve the core message but vary the phrasing, structure and energy.
- Do not add hashtags unless the original has them.
- Respond with ONLY valid JSON, no prose:
{"variants":["variation 1","variation 2"]}`;
}
