import en from './i18n/messages/en';
import pl from './i18n/messages/pl';

type Tree = { [k: string]: string | Tree };

function leaves(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (node === null || node === undefined) return out;
  if (typeof node === 'string') {
    out.set(prefix, node);
    return out;
  }
  for (const [k, v] of Object.entries(node as Tree)) {
    leaves(v, prefix ? `${prefix}.${k}` : k).forEach((val, key) => out.set(key, val));
  }
  return out;
}

const placeholders = (s: string): string[] =>
  Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();

const NAMESPACES = ['agentActivity', 'policies'] as const;

describe.each(NAMESPACES)('agent center i18n namespace %s', (ns) => {
  const enLeaves = leaves((en as unknown as Record<string, unknown>)?.[ns], ns);
  const plLeaves = leaves((pl as unknown as Record<string, unknown>)?.[ns], ns);

  it('has every English key in Polish', () => {
    const missing = Array.from(enLeaves.keys()).filter((k) => !plLeaves.has(k));
    expect(missing).toEqual([]);
  });

  it('has no extra Polish keys', () => {
    const extra = Array.from(plLeaves.keys()).filter((k) => !enLeaves.has(k));
    expect(extra).toEqual([]);
  });

  it('keeps the same placeholders per key', () => {
    enLeaves.forEach((value, key) => {
      const other = plLeaves.get(key);
      if (other === undefined) return;
      expect([key, placeholders(other)]).toEqual([key, placeholders(value)]);
    });
  });

  it('has no en or em dashes', () => {
    const bad: string[] = [];
    [enLeaves, plLeaves].forEach((m) =>
      m.forEach((value, key) => {
        if (/[\u2013\u2014]/.test(value)) bad.push(key);
      })
    );
    expect(bad).toEqual([]);
  });
});

// The key permission block of settingsApi (Phase 4 Task 15). The namespace
// itself is older, so only the keys added by this phase are compared.
const KEY_PERMISSION_KEYS = [
  'permissionsTitle',
  'limitToggle',
  'actionsLabel',
  'action_DRAFT',
  'action_SCHEDULE',
  'action_PUBLISH_NOW',
  'channelsLabel',
  'channelsAll',
  'noChannels',
  'channelsLoadFailed',
  'unavailableItem',
  'staleChannelsNote',
  'permissionsEmptyHint',
  'permissionsScope',
  'colPermissions',
  'permAll',
  'permSummary',
  'permActionsAll',
  'permChannelOne',
  'permChannelsFew',
  'permChannels',
] as const;

describe('settingsApi key permission keys', () => {
  const enApi = (en as unknown as { settingsApi: Record<string, string> }).settingsApi;
  const plApi = (pl as unknown as { settingsApi: Record<string, string> }).settingsApi;

  it.each(KEY_PERMISSION_KEYS)('has %s in English and Polish', (key) => {
    expect(typeof enApi[key]).toBe('string');
    expect(typeof plApi[key]).toBe('string');
    expect(enApi[key].length).toBeGreaterThan(0);
    expect(plApi[key].length).toBeGreaterThan(0);
    expect(placeholders(plApi[key])).toEqual(placeholders(enApi[key]));
    expect(/[\u2013\u2014]/.test(enApi[key] + plApi[key])).toBe(false);
  });
});
