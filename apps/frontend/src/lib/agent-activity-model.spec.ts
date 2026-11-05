import {
  BUCKET_WEIGHT,
  FILTER_BUCKETS,
  TILE_BUCKET,
  bucketLabelKey,
  mergeGroupPages,
  pruneSelection,
  selectedApprovalIds,
  toggleGroup,
} from './agent-activity-model';

const g = (group: string, ids: string[] = []) => ({ group, pendingApprovalIds: ids, marker: group + ids.length });

describe('agent activity model', () => {
  it('mergeGroupPages dedupes by group, keeps first occurrence and order', () => {
    const prev = [g('a', ['1']), g('b')];
    const next = [g('b', ['9']), g('c'), g('a'), g('d')];
    const merged = mergeGroupPages(prev, next);
    expect(merged.map((x) => x.group)).toEqual(['a', 'b', 'c', 'd']);
    expect(merged[1]).toBe(prev[1]);
    expect(prev).toHaveLength(2);
  });

  it('toggleGroup does not mutate its input', () => {
    const sel = new Set(['a']);
    const added = toggleGroup(sel, 'b');
    expect(Array.from(sel)).toEqual(['a']);
    expect(Array.from(added).sort()).toEqual(['a', 'b']);
    expect(Array.from(toggleGroup(added, 'a'))).toEqual(['b']);
  });

  it('selectedApprovalIds ignores groups without pending ids and dedupes', () => {
    const groups = [g('a', ['1', '2']), g('b'), g('c', ['2', '3'])];
    expect(selectedApprovalIds(groups, new Set(['a', 'b', 'c']))).toEqual(['1', '2', '3']);
    expect(selectedApprovalIds(groups, new Set(['b']))).toEqual([]);
    expect(selectedApprovalIds(groups, new Set())).toEqual([]);
  });

  it('selectedApprovalIds caps at 50', () => {
    const many = Array.from({ length: 80 }, (_, i) => `id${i}`);
    const ids = selectedApprovalIds([g('a', many)], new Set(['a']));
    expect(ids).toHaveLength(50);
    expect(ids[49]).toBe('id49');
    const two = selectedApprovalIds([g('a', many.slice(0, 30)), g('b', many.slice(30, 80))], new Set(['a', 'b']));
    expect(two).toHaveLength(50);
  });

  it('pruneSelection drops vanished groups and groups without pending approvals', () => {
    const groups = [g('a', ['1']), g('b')];
    const pruned = pruneSelection(new Set(['a', 'b', 'gone']), groups);
    expect(Array.from(pruned)).toEqual(['a']);
  });

  it('FILTER_BUCKETS has no duplicates and the specified order', () => {
    expect(new Set(FILTER_BUCKETS).size).toBe(FILTER_BUCKETS.length);
    expect(FILTER_BUCKETS).toEqual([
      'attention', 'review', 'blocked', 'failed', 'published', 'scheduled', 'draft', 'all',
    ]);
  });

  it('every row bucket has a weight', () => {
    const rows = [
      'unknown_outcome', 'blocked', 'retryable', 'failed_other', 'review', 'held', 'scheduled', 'draft', 'published',
    ];
    expect(Object.keys(BUCKET_WEIGHT).sort()).toEqual(rows.slice().sort());
    expect(BUCKET_WEIGHT.unknown_outcome).toBe('filled');
    expect(BUCKET_WEIGHT.blocked).toBe('filled');
    expect(BUCKET_WEIGHT.review).toBe('dotted');
    expect(BUCKET_WEIGHT.held).toBe('struck');
  });

  it('exposes tile buckets and label keys', () => {
    expect(TILE_BUCKET).toEqual({ review: 'review', blocked: 'blocked', failed: 'failed' });
    expect(bucketLabelKey('failed_other')).toBe('agentActivity.bucket.failed_other');
  });
});
