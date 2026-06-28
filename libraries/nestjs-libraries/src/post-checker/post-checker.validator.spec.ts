import { parseCheckResult } from './post-checker.validator';

describe('parseCheckResult', () => {
  it('parses clean JSON', () => {
    const raw = JSON.stringify({ score: 72, dimensions: { hook: 85, clarity: 70, cta: 60, platformFit: 75 }, positives: ['Strong hook'], negatives: ['Weak CTA'] });
    expect(parseCheckResult(raw).score).toBe(72);
  });
  it('extracts JSON from a fenced code block', () => {
    const raw = '```json\n{"score":50,"dimensions":{"hook":50,"clarity":50,"cta":50,"platformFit":50},"positives":[],"negatives":[]}\n```';
    expect(parseCheckResult(raw).dimensions.hook).toBe(50);
  });
  it('clamps out-of-range scores to 0..100', () => {
    const raw = '{"score":140,"dimensions":{"hook":-5,"clarity":50,"cta":50,"platformFit":50},"positives":[],"negatives":[]}';
    const r = parseCheckResult(raw);
    expect(r.score).toBe(100);
    expect(r.dimensions.hook).toBe(0);
  });
  it('throws on non-JSON', () => {
    expect(() => parseCheckResult('the post looks great!')).toThrow();
  });
});
