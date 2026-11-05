import { decodeGroupCursor, encodeGroupCursor } from './activity-cursor';

describe('group cursor', () => {
  it('round trips including milliseconds', () => {
    const updatedAt = new Date('2026-11-04T10:20:30.123Z');
    const out = decodeGroupCursor(encodeGroupCursor({ updatedAt, group: 'g-1' }));
    expect(out).not.toBeNull();
    expect(out!.updatedAt.getTime()).toBe(updatedAt.getTime());
    expect(out!.group).toBe('g-1');
  });
  it('is url safe', () => {
    const s = encodeGroupCursor({ updatedAt: new Date(), group: 'a/b+c?d' });
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('rejects malformed input', () => {
    const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
    expect(decodeGroupCursor('%%%')).toBeNull();
    expect(decodeGroupCursor('')).toBeNull();
    expect(decodeGroupCursor(b64('not json'))).toBeNull();
    expect(decodeGroupCursor(b64({ t: 'nope', g: 'x' }))).toBeNull();
    expect(decodeGroupCursor(b64({ t: new Date().toISOString(), g: '' }))).toBeNull();
    expect(decodeGroupCursor(b64({ t: new Date().toISOString(), g: 'a'.repeat(101) }))).toBeNull();
    expect(decodeGroupCursor(b64({ t: new Date().toISOString(), g: 5 }))).toBeNull();
    expect(decodeGroupCursor(b64([1, 2]))).toBeNull();
    expect(decodeGroupCursor(b64(null))).toBeNull();
  });
});
