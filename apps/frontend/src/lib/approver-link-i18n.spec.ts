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

const REQUIRED = [
  'title', 'decidingAs', 'stage', 'requestedBy', 'approve', 'reject',
  'notePlaceholder', 'selfBlocked', 'doneApproved', 'doneRejected',
  'doneAdvanced', 'errInvalid', 'errNotAllowed', 'errResolved', 'errRate',
  'errNetwork',
];

describe('approverLink i18n namespace', () => {
  const enLeaves = leaves((en as unknown as Record<string, unknown>).approverLink, 'approverLink');
  const plLeaves = leaves((pl as unknown as Record<string, unknown>).approverLink, 'approverLink');

  it('has every required key in both languages', () => {
    for (const k of REQUIRED) {
      expect(enLeaves.has(`approverLink.${k}`)).toBe(true);
      expect(plLeaves.has(`approverLink.${k}`)).toBe(true);
    }
  });

  it('has the same keys in English and Polish', () => {
    expect(Array.from(plLeaves.keys()).sort()).toEqual(Array.from(enLeaves.keys()).sort());
  });

  it('keeps the same placeholders per key', () => {
    enLeaves.forEach((value, key) => {
      const other = plLeaves.get(key);
      if (other === undefined) return;
      expect([key, placeholders(other)]).toEqual([key, placeholders(value)]);
    });
  });

  it('has no empty strings and no en or em dashes', () => {
    const bad: string[] = [];
    [enLeaves, plLeaves].forEach((m) =>
      m.forEach((value, key) => {
        if (value.trim().length === 0 || /[–—]/.test(value)) bad.push(key);
      }),
    );
    expect(bad).toEqual([]);
  });
});
