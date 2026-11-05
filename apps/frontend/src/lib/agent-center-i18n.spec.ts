import en from './i18n/messages/en';
import pl from './i18n/messages/pl';
import ru from './i18n/messages/ru';
import zh from './i18n/messages/zh';
import fr from './i18n/messages/fr';
import de from './i18n/messages/de';
import pt from './i18n/messages/pt';
import itMessages from './i18n/messages/it';
import ja from './i18n/messages/ja';
import ko from './i18n/messages/ko';
import tr from './i18n/messages/tr';

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

// Policy outcome keys of the composer and calendar (Phase 4 Task 16).
const CREATE_POST_POLICY_KEYS = [
  'policyBlocked',
  'policyBlockedNoRules',
  'policyApprovalSent',
  'policyInputTooLarge',
] as const;

describe('createPost policy keys', () => {
  const enCp = (en as unknown as { createPost: Record<string, string> }).createPost;
  const plCp = (pl as unknown as { createPost: Record<string, string> }).createPost;

  it.each(CREATE_POST_POLICY_KEYS)('has %s in English and Polish', (key) => {
    expect(typeof enCp[key]).toBe('string');
    expect(typeof plCp[key]).toBe('string');
    expect(enCp[key].length).toBeGreaterThan(0);
    expect(plCp[key].length).toBeGreaterThan(0);
    expect(placeholders(plCp[key])).toEqual(placeholders(enCp[key]));
    expect(/[\u2013\u2014]/.test(enCp[key] + plCp[key])).toBe(false);
  });

  it('keeps the rules placeholder in the blocked text', () => {
    expect(placeholders(enCp.policyBlocked)).toEqual(['rules']);
  });
});

// Every key of the existing namespaces that Phase 4 added must exist in all
// eleven locale files (agentActivity and policies fall back to English by
// design, so they are not listed here).
const ALL_LOCALES: Array<[string, unknown]> = [
  ['en', en],
  ['pl', pl],
  ['ru', ru],
  ['zh', zh],
  ['fr', fr],
  ['de', de],
  ['pt', pt],
  ['it', itMessages],
  ['ja', ja],
  ['ko', ko],
  ['tr', tr],
];

const ALL_LOCALE_KEYS: string[] = [
  'nav.agents',
  'settings.policies',
  ...KEY_PERMISSION_KEYS.map((k) => `settingsApi.${k}`),
  ...CREATE_POST_POLICY_KEYS.map((k) => `createPost.${k}`),
];

const lookup = (messages: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages
    );

describe('Phase 4 keys in all locales', () => {
  it('lists exactly the keys that exist in English', () => {
    const enApi = Object.keys((en as unknown as { settingsApi: object }).settingsApi);
    expect(KEY_PERMISSION_KEYS.filter((k) => !enApi.includes(k))).toEqual([]);
    expect(ALL_LOCALE_KEYS.length).toBe(2 + KEY_PERMISSION_KEYS.length + CREATE_POST_POLICY_KEYS.length);
  });

  describe.each(ALL_LOCALES)('locale %s', (_name, messages) => {
    it.each(ALL_LOCALE_KEYS)('%s is a non-empty string with the English placeholders and no dashes', (key) => {
      const value = lookup(messages, key);
      const english = lookup(en, key) as string;
      expect(typeof value).toBe('string');
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(placeholders(value as string)).toEqual(placeholders(english));
      expect(/[\u2013\u2014]/.test(value as string)).toBe(false);
    });
  });
});
