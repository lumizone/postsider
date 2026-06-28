import { CheckInput } from './post-checker.types';

export function buildCheckPrompt(input: CheckInput): string {
  const media = input.hasMedia ? `The post includes ${input.mediaType ?? 'media'}.` : 'The post has no attached media.';
  return [
    `You are a social media virality analyst. Assess the RELATIVE potential of the post below for the platform "${input.platform}".`,
    `Do not promise exact views or engagement — judge relative potential only.`,
    media,
    `Score the post 0-100 overall and on four dimensions: hook (stops the scroll), clarity, cta (clear next action), platformFit (fits ${input.platform} norms/length/tone).`,
    `List up to 4 short "positives" (what works) and up to 4 short "negatives" (what weakens it).`,
    ``,
    `POST:`, `"""`, input.content, `"""`, ``,
    `Respond with ONLY valid JSON, no prose, in exactly this shape:`,
    `{"score":0,"dimensions":{"hook":0,"clarity":0,"cta":0,"platformFit":0},"positives":[],"negatives":[]}`,
  ].join('\n');
}
