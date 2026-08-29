import { buildRewritePrompt } from './rewrite.prompt';
import { parseRewriteResult } from './rewrite.validator';

describe('buildRewritePrompt', () => {
  it('includes the content, count and JSON instruction', () => {
    const p = buildRewritePrompt({ content: 'hello world', count: 4 });
    expect(p).toContain('hello world');
    expect(p).toContain('4 distinct variations');
    expect(p).toContain('"variants"');
  });
  it('mentions the platform when provided', () => {
    expect(buildRewritePrompt({ content: 'x', platform: 'linkedin' })).toContain(
      'linkedin'
    );
  });
  it('describes the shorten tone as reducing characters', () => {
    expect(buildRewritePrompt({ content: 'x', tone: 'shorten' })).toMatch(
      /fewer characters/i
    );
  });
});

describe('parseRewriteResult', () => {
  it('parses clean JSON', () => {
    expect(parseRewriteResult('{"variants":["a","b","c"]}').variants).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('extracts JSON from surrounding prose', () => {
    expect(parseRewriteResult('Sure! {"variants":["a"]} done').variants).toEqual([
      'a',
    ]);
  });
  it('slices to the requested count', () => {
    expect(parseRewriteResult('{"variants":["a","b","c"]}', 2).variants).toEqual([
      'a',
      'b',
    ]);
  });
  it('drops non-string and empty entries', () => {
    expect(parseRewriteResult('{"variants":["a","",1,"b"]}').variants).toEqual([
      'a',
      'b',
    ]);
  });
  it('throws on non-JSON', () => {
    expect(() => parseRewriteResult('no json here')).toThrow();
  });
  it('throws when the variants array is missing', () => {
    expect(() => parseRewriteResult('{"foo":1}')).toThrow();
  });
});
