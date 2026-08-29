import { pickNextEvergreen } from './evergreen.selection';
type P = { id: string; lastRecycledAt: Date | null };
describe('pickNextEvergreen', () => {
  it('returns null when there are no candidates', () => { expect(pickNextEvergreen([], 7, new Date())).toBeNull(); });
  it('prefers a never-recycled post', () => {
    const now = new Date('2026-06-27T12:00:00Z');
    const posts: P[] = [{ id: 'a', lastRecycledAt: new Date('2026-06-20T00:00:00Z') }, { id: 'b', lastRecycledAt: null }];
    expect(pickNextEvergreen(posts, 7, now)!.id).toBe('b');
  });
  it('skips posts recycled within intervalDays', () => {
    const now = new Date('2026-06-27T12:00:00Z');
    const posts: P[] = [{ id: 'a', lastRecycledAt: new Date('2026-06-25T00:00:00Z') }];
    expect(pickNextEvergreen(posts, 7, now)).toBeNull();
  });
  it('among eligible, picks the least-recently recycled', () => {
    const now = new Date('2026-06-27T12:00:00Z');
    const posts: P[] = [{ id: 'a', lastRecycledAt: new Date('2026-06-01T00:00:00Z') }, { id: 'b', lastRecycledAt: new Date('2026-06-10T00:00:00Z') }];
    expect(pickNextEvergreen(posts, 7, now)!.id).toBe('a');
  });
});
