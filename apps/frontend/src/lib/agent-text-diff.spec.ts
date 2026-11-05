import { compareDestinations, diffWords } from './agent-text-diff';

const join = (parts: { text: string; kind: string }[], skip: string) =>
  parts.filter((p) => p.kind !== skip).map((p) => p.text).join('');

describe('diffWords', () => {
  it('marks identical strings as all same', () => {
    const parts = diffWords('hello big world', 'hello big world');
    expect(parts.every((p) => p.kind === 'same')).toBe(true);
    expect(parts.map((p) => p.text).join('')).toBe('hello big world');
  });

  it('marks one replaced word as removed then added, only for that word', () => {
    const parts = diffWords('hello big world', 'hello small world');
    const changed = parts.filter((p) => p.kind !== 'same');
    expect(changed.map((p) => [p.kind, p.text.trim()])).toEqual([
      ['removed', 'big'],
      ['added', 'small'],
    ]);
    expect(parts.findIndex((p) => p.kind === 'removed')).toBeLessThan(
      parts.findIndex((p) => p.kind === 'added')
    );
    expect(join(parts, 'removed')).toBe('hello small world');
    expect(join(parts, 'added')).toBe('hello big world');
  });

  it('handles an insertion at the end', () => {
    const parts = diffWords('one two', 'one two three');
    expect(parts.filter((p) => p.kind === 'added').map((p) => p.text.trim())).toEqual(['three']);
    expect(parts.some((p) => p.kind === 'removed')).toBe(false);
    expect(join(parts, 'removed')).toBe('one two three');
  });

  it('handles both empty', () => {
    expect(diffWords('', '')).toEqual([]);
  });

  it('keeps newlines and leading whitespace', () => {
    const parts = diffWords('  a\nb', '  a\nc');
    expect(join(parts, 'removed')).toBe('  a\nc');
  });

  it('is deterministic', () => {
    expect(diffWords('a b c d', 'a x c y')).toEqual(diffWords('a b c d', 'a x c y'));
  });

  it('finishes 2000 word inputs under 200ms', () => {
    const a = Array.from({ length: 2000 }, (_, i) => 'w' + i).join(' ');
    const b = Array.from({ length: 2000 }, (_, i) => (i % 3 === 0 ? 'x' + i : 'w' + i)).join(' ');
    const start = Date.now();
    const parts = diffWords(a, b);
    expect(Date.now() - start).toBeLessThan(200);
    expect(join(parts, 'removed')).toBe(b);
    expect(join(parts, 'added')).toBe(a);
  });

  it('falls back to a coarse diff for huge inputs without hanging', () => {
    const a = Array.from({ length: 12000 }, (_, i) => 'a' + i).join(' ');
    const b = Array.from({ length: 12000 }, (_, i) => 'b' + i).join(' ');
    const start = Date.now();
    const parts = diffWords(a, b);
    expect(Date.now() - start).toBeLessThan(500);
    expect(join(parts, 'removed')).toBe(b);
  });
});

describe('compareDestinations', () => {
  it('ignores whitespace-run differences', () => {
    const r = compareDestinations([
      { id: '1', name: 'A', text: 'hello   world\n' },
      { id: '2', name: 'B', text: 'hello world' },
    ]);
    expect(r.identical).toBe(true);
    expect(r.others[0].identical).toBe(true);
  });

  it('uses the first item as baseline and diffs every other against it', () => {
    const r = compareDestinations([
      { id: '1', name: 'A', text: 'one two three' },
      { id: '2', name: 'B', text: 'one 2 three' },
      { id: '3', name: 'C', text: 'one two three four' },
    ]);
    expect(r.identical).toBe(false);
    expect(r.baseline).toEqual({ id: '1', name: 'A' });
    expect(r.others.map((o) => o.id)).toEqual(['2', '3']);
    expect(r.others[0].identical).toBe(false);
    expect(r.others[0].parts.some((p) => p.kind === 'added' && p.text.trim() === '2')).toBe(true);
    expect(r.others[1].parts.some((p) => p.kind === 'added' && p.text.trim() === 'four')).toBe(true);
  });

  it('marks a single destination as identical with no others', () => {
    const r = compareDestinations([{ id: '1', name: 'A', text: 'x' }]);
    expect(r.identical).toBe(true);
    expect(r.others).toEqual([]);
  });
});
