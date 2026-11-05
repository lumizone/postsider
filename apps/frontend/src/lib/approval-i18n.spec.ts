import en from './i18n/messages/en';
import pl from './i18n/messages/pl';
import { FLOW_VALIDATION_KEYS } from './approval-flows-model';
import { STAGE_REASON_KEYS, STAGE_SHAPE_KEYS } from './approval-stage-model';

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

const placeholders = (s: string): string[] => Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();

const lookup = (messages: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      messages
    );

describe('approvalFlows namespace', () => {
  const enLeaves = leaves((en as unknown as Record<string, unknown>).approvalFlows, 'approvalFlows');
  const plLeaves = leaves((pl as unknown as Record<string, unknown>).approvalFlows, 'approvalFlows');

  it('exists and is not empty', () => {
    expect(enLeaves.size).toBeGreaterThan(20);
  });

  it('has every English key in Polish and no extras', () => {
    expect(Array.from(enLeaves.keys()).filter((k) => !plLeaves.has(k))).toEqual([]);
    expect(Array.from(plLeaves.keys()).filter((k) => !enLeaves.has(k))).toEqual([]);
  });

  it('keeps the same placeholders per key', () => {
    enLeaves.forEach((value, key) => {
      const other = plLeaves.get(key);
      if (other !== undefined) expect([key, placeholders(other)]).toEqual([key, placeholders(value)]);
    });
  });

  it('has no empty text and no en or em dashes', () => {
    const bad: string[] = [];
    [enLeaves, plLeaves].forEach((m) =>
      m.forEach((value, key) => {
        if (value.trim().length === 0 || /[–—]/.test(value)) bad.push(key);
      })
    );
    expect(bad).toEqual([]);
  });
});

// The stage keys of the existing approval namespace and the keys the pure
// models and pages rely on.
const APPROVAL_KEYS = [
  'stageOf',
  'stageProgress',
  'stageStatusApproved',
  'stageStatusPending',
  'stageStatusRejected',
  'stageStatusNotReached',
  'guestLinkActive',
  'guestLinkNotAllowed',
  'errorNotAllowed',
  'errorSelfApproval',
  'errorAlreadyResolved',
  'errorStageMoved',
  'errorKeyScope',
  ...STAGE_REASON_KEYS.map((k) => k.replace(/^approval\./, '')),
  ...STAGE_SHAPE_KEYS.map((k) => k.replace(/^approval\./, '')),
] as const;

const NEW_KEYS: string[] = [
  ...APPROVAL_KEYS.map((k) => `approval.${k}`),
  ...FLOW_VALIDATION_KEYS,
  'settings.approvalFlows',
  'settingsApi.approvalsDecideWarning',
];

describe('keys used by the approval pages and models', () => {
  it.each(NEW_KEYS)('%s is a non-empty string in English and Polish with the same placeholders', (key) => {
    const e = lookup(en, key);
    const p = lookup(pl, key);
    expect(typeof e).toBe('string');
    expect(typeof p).toBe('string');
    expect((e as string).trim().length).toBeGreaterThan(0);
    expect((p as string).trim().length).toBeGreaterThan(0);
    expect(placeholders(p as string)).toEqual(placeholders(e as string));
    expect(/[–—]/.test((e as string) + (p as string))).toBe(false);
  });

  it('the stage progress text carries position, total and name', () => {
    expect(placeholders(lookup(en, 'approval.stageOf') as string)).toEqual(['name', 'position', 'total']);
  });

  it('uses the zasady wording for policies in the Polish flow texts', () => {
    const text = JSON.stringify((pl as unknown as Record<string, unknown>).approvalFlows);
    expect(text).not.toMatch(/polityk|regulamin/i);
  });
});
