import { CheckResult } from './post-checker.types';

const clamp = (n: unknown): number => {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
};

export function parseCheckResult(raw: string): CheckResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in LLM response');
  const obj = JSON.parse(match[0]);
  const d = obj.dimensions || {};
  return {
    score: clamp(obj.score),
    dimensions: { hook: clamp(d.hook), clarity: clamp(d.clarity), cta: clamp(d.cta), platformFit: clamp(d.platformFit) },
    positives: Array.isArray(obj.positives) ? obj.positives.map(String).slice(0, 4) : [],
    negatives: Array.isArray(obj.negatives) ? obj.negatives.map(String).slice(0, 4) : [],
  };
}
