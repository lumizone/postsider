import {
  DEFAULT_FILTERS,
  filtersFromSearch,
  filtersToSearch,
  hasActiveFilters,
  toApiQuery,
} from './agent-activity-filters';

describe('agent activity filters', () => {
  it('round trips a full query', () => {
    const s =
      'bucket=failed&scope=automation&integrationIds=a%2Cb&actor=API_KEY%3Ak1&agentName=Bot+One&source=zapier&from=2026-11-01&to=2026-11-04';
    const f = filtersFromSearch(s);
    expect(f).toEqual({
      bucket: 'failed',
      scope: 'automation',
      integrationIds: ['a', 'b'],
      actor: 'API_KEY:k1',
      agentName: 'Bot One',
      source: 'zapier',
      from: '2026-11-01',
      to: '2026-11-04',
    });
    expect(filtersFromSearch(filtersToSearch(f))).toEqual(f);
    expect(filtersToSearch(f)).toBe(s);
  });

  it('serializes the default state to an empty string', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    expect(filtersFromSearch('')).toEqual(DEFAULT_FILTERS);
    expect(filtersFromSearch('?')).toEqual(DEFAULT_FILTERS);
  });

  it('falls back on unknown bucket and bad dates', () => {
    expect(filtersFromSearch('?bucket=nope').bucket).toBe('attention');
    expect(filtersFromSearch('from=2026-13-40').from).toBe('');
    expect(filtersFromSearch('to=2026-02-31').to).toBe('');
    expect(filtersFromSearch('from=yesterday').from).toBe('');
  });

  it('keeps at most 20 integration ids', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `i${i}`).join(',');
    expect(filtersFromSearch(`integrationIds=${ids}`).integrationIds).toHaveLength(20);
  });

  it('builds the API query', () => {
    expect(toApiQuery(DEFAULT_FILTERS)).toEqual({ bucket: 'attention', scope: 'relevant' });
    const q = toApiQuery(
      { ...DEFAULT_FILTERS, integrationIds: ['a', 'b'], from: '2026-11-04', to: '2026-11-04', source: 'x' },
      25
    );
    expect(q.integrationIds).toBe('a,b');
    expect(q.from).toBe(new Date(2026, 10, 4, 0, 0, 0, 0).toISOString());
    expect(q.to).toBe(new Date(2026, 10, 4, 23, 59, 59, 999).toISOString());
    expect(q.source).toBe('x');
    expect(q.limit).toBe('25');
    expect('actor' in q).toBe(false);
    expect('agentName' in q).toBe(false);
  });

  it('detects active filters', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, bucket: 'all' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, actor: 'USER:1' })).toBe(true);
  });
});
