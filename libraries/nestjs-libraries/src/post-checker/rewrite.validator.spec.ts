import { parseRewriteResult } from './rewrite.validator';

describe('parseRewriteResult', () => {
  it('trims variants and removes duplicates', () => {
    const raw = '{"variants":[" First version ","first   version","Second version"]}';
    expect(parseRewriteResult(raw, 3)).toEqual({
      variants: ['First version', 'Second version'],
    });
  });

  it('throws when every variant is empty', () => {
    expect(() => parseRewriteResult('{"variants":[" ",null]}')).toThrow('No variants returned');
  });
});
