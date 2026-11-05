import {
  KEY_ACTIONS,
  channelCountKey,
  describePermissions,
  isPermissionsSaveable,
  permissionsFromRow,
  permissionsPayload,
  reconcileWithKnown,
  type KeyPermissionsState,
} from './key-permissions-model';

describe('permissionsFromRow', () => {
  it('treats an empty row as unlimited', () => {
    expect(permissionsFromRow({})).toEqual({ limited: false, actions: [], integrationIds: [] });
    expect(permissionsFromRow({ allowedActions: [], allowedIntegrationIds: [] }).limited).toBe(false);
  });

  it('is limited when either list is non-empty', () => {
    const a = permissionsFromRow({ allowedActions: ['DRAFT'], allowedIntegrationIds: [] });
    expect(a).toEqual({ limited: true, actions: ['DRAFT'], integrationIds: [] });
    const b = permissionsFromRow({ allowedActions: [], allowedIntegrationIds: ['c1'] });
    expect(b).toEqual({ limited: true, actions: [], integrationIds: ['c1'] });
  });

  it('drops unknown and duplicate action strings', () => {
    const s = permissionsFromRow({ allowedActions: ['DRAFT', 'HACK', 'DRAFT'] });
    expect(s.actions).toEqual(['DRAFT']);
  });

  it('a row with only unknown actions is not limited', () => {
    expect(permissionsFromRow({ allowedActions: ['HACK'] }).limited).toBe(false);
  });

  it('keeps action order stable', () => {
    expect(permissionsFromRow({ allowedActions: ['PUBLISH_NOW', 'DRAFT'] }).actions).toEqual(['DRAFT', 'PUBLISH_NOW']);
    expect(KEY_ACTIONS).toEqual(['DRAFT', 'SCHEDULE', 'PUBLISH_NOW']);
  });
});

describe('permissionsPayload', () => {
  it('sends two empty arrays when not limited, even if lists were filled', () => {
    const s: KeyPermissionsState = { limited: false, actions: ['DRAFT'], integrationIds: ['c1'] };
    expect(permissionsPayload(s)).toEqual({ allowedActions: [], allowedIntegrationIds: [] });
  });

  it('sends both lists when limited, deduplicated', () => {
    const s: KeyPermissionsState = { limited: true, actions: ['SCHEDULE', 'SCHEDULE'], integrationIds: ['c1', 'c1', 'c2'] };
    expect(permissionsPayload(s)).toEqual({ allowedActions: ['SCHEDULE'], allowedIntegrationIds: ['c1', 'c2'] });
  });

  it('always has both keys, never null', () => {
    const p = permissionsPayload({ limited: true, actions: [], integrationIds: ['c1'] });
    expect(p.allowedActions).toEqual([]);
    expect(p.allowedIntegrationIds).toEqual(['c1']);
  });
});

describe('isPermissionsSaveable', () => {
  it('rejects limited with both lists empty', () => {
    expect(isPermissionsSaveable({ limited: true, actions: [], integrationIds: [] })).toBe(false);
  });
  it('accepts limited with either list filled', () => {
    expect(isPermissionsSaveable({ limited: true, actions: ['DRAFT'], integrationIds: [] })).toBe(true);
    expect(isPermissionsSaveable({ limited: true, actions: [], integrationIds: ['c1'] })).toBe(true);
  });
  it('accepts not limited', () => {
    expect(isPermissionsSaveable({ limited: false, actions: [], integrationIds: [] })).toBe(true);
  });
});

describe('reconcileWithKnown', () => {
  const s: KeyPermissionsState = { limited: true, actions: [], integrationIds: ['live', 'gone'] };

  it('drops ids that are not in the known list and counts them', () => {
    const r = reconcileWithKnown(s, ['live', 'other']);
    expect(r.state.integrationIds).toEqual(['live']);
    expect(r.dropped).toBe(1);
  });

  it('a limit with only stale ids becomes unsaveable', () => {
    const r = reconcileWithKnown({ ...s, integrationIds: ['gone'] }, ['live']);
    expect(r.state.integrationIds).toEqual([]);
    expect(isPermissionsSaveable(r.state)).toBe(false);
  });

  it('keeps everything when the known list is not available', () => {
    const r = reconcileWithKnown(s, null);
    expect(r.state).toEqual(s);
    expect(r.dropped).toBe(0);
  });

  it('does not touch an unlimited state', () => {
    const u: KeyPermissionsState = { limited: false, actions: [], integrationIds: ['gone'] };
    expect(reconcileWithKnown(u, ['live']).dropped).toBe(0);
  });
});

describe('describePermissions', () => {
  const names: Record<string, string> = { c1: 'Alpha' };
  const nameOf = (id: string) => names[id];

  it('returns nulls for an unrestricted row', () => {
    expect(describePermissions({}, nameOf)).toEqual({ actions: null, channelCount: null, channelNames: [] });
  });

  it('counts all ids but names only the known ones', () => {
    const d = describePermissions({ allowedActions: [], allowedIntegrationIds: ['c1', 'zzz'] }, nameOf);
    expect(d.actions).toBeNull();
    expect(d.channelCount).toBe(2);
    expect(d.channelNames).toEqual(['Alpha']);
  });

  it('lists actions and drops unknown ones', () => {
    const d = describePermissions({ allowedActions: ['DRAFT', 'HACK'], allowedIntegrationIds: [] }, nameOf);
    expect(d.actions).toEqual(['DRAFT']);
    expect(d.channelCount).toBeNull();
  });
});

describe('channelCountKey', () => {
  it('picks the plural form per locale', () => {
    expect(channelCountKey(1, 'en')).toBe('one');
    expect(channelCountKey(3, 'en')).toBe('many');
    expect(channelCountKey(1, 'pl')).toBe('one');
    expect(channelCountKey(3, 'pl')).toBe('few');
    expect(channelCountKey(5, 'pl')).toBe('many');
  });
  it('falls back for a bad locale', () => {
    expect(channelCountKey(2, 'not a locale!!')).toBe('many');
  });
});
