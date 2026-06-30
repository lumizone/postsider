import { RewriteResult } from './rewrite.types';

export function parseRewriteResult(raw: string, count = 3): RewriteResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in LLM response');
  const obj = JSON.parse(match[0]);
  if (!Array.isArray(obj.variants)) {
    throw new Error('No variants array in LLM response');
  }
  const variants = obj.variants
    .filter((v: unknown) => typeof v === 'string' && v.trim().length > 0)
    .map(String)
    .slice(0, Math.max(1, Math.min(5, count)));
  if (!variants.length) throw new Error('No variants returned');
  return { variants };
}
