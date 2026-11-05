// Pure word-level diff for the agent activity compare view. No React, no DOM.

export type DiffPart = { text: string; kind: 'same' | 'added' | 'removed' };

/** Above this many table cells the exact LCS is skipped (memory and time guard). */
const MAX_CELLS = 16_000_000;

type Token = { text: string; key: string };

/** Each token is a word plus its trailing whitespace; leading whitespace joins the first token. */
function tokenize(input: string): Token[] {
  const text = input ?? '';
  const matches = text.match(/\S+\s*/g) ?? [];
  const lead = text.match(/^\s+/)?.[0] ?? '';
  const tokens = matches.map((m) => ({ text: m, key: m.trim() }));
  if (lead) {
    if (tokens.length > 0) tokens[0] = { text: lead + tokens[0].text, key: tokens[0].key };
    else tokens.push({ text: lead, key: '' });
  }
  return tokens;
}

function push(parts: DiffPart[], kind: DiffPart['kind'], text: string): void {
  if (text === '') return;
  const last = parts[parts.length - 1];
  if (last && last.kind === kind) last.text += text;
  else parts.push({ text, kind });
}

/**
 * Word-level LCS diff of `a` (old) against `b` (new). Whitespace is preserved:
 * the non-removed parts concatenate to exactly `b`, the non-added parts to
 * the words of `a`. A replaced word yields `removed` then `added`.
 */
export function diffWords(a: string, b: string): DiffPart[] {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const parts: DiffPart[] = [];

  let start = 0;
  while (start < ta.length && start < tb.length && ta[start].key === tb[start].key) start++;
  let endA = ta.length;
  let endB = tb.length;
  while (endA > start && endB > start && ta[endA - 1].key === tb[endB - 1].key) {
    endA--;
    endB--;
  }

  for (let k = 0; k < start; k++) push(parts, 'same', tb[k].text);

  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) {
    // Pure insertion, pure removal, or too large for the exact table.
    for (let k = start; k < endA; k++) push(parts, 'removed', ta[k].text);
    for (let k = start; k < endB; k++) push(parts, 'added', tb[k].text);
  } else {
    // Intern words to integers so the hot loop compares numbers, not strings.
    const ids = new Map<string, number>();
    const intern = (key: string): number => {
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      return id;
    };
    const ia = Int32Array.from({ length: n }, (_, k) => intern(ta[start + k].key));
    const ib = Int32Array.from({ length: m }, (_, k) => intern(tb[start + k].key));
    const w = m + 1;
    const table = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      const row = i * w;
      const next = row + w;
      const ai = ia[i];
      for (let j = m - 1; j >= 0; j--) {
        if (ai === ib[j]) table[row + j] = table[next + j + 1] + 1;
        else {
          const down = table[next + j];
          const right = table[row + j + 1];
          table[row + j] = down >= right ? down : right;
        }
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (ia[i] === ib[j]) {
        push(parts, 'same', tb[start + j].text);
        i++;
        j++;
      } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
        push(parts, 'removed', ta[start + i].text);
        i++;
      } else {
        push(parts, 'added', tb[start + j].text);
        j++;
      }
    }
    while (i < n) push(parts, 'removed', ta[start + i++].text);
    while (j < m) push(parts, 'added', tb[start + j++].text);
  }

  for (let k = endB; k < tb.length; k++) push(parts, 'same', tb[k].text);
  return parts;
}

const normalize = (s: string): string => (s ?? '').replace(/\s+/g, ' ').trim();

export interface CompareResult {
  identical: boolean;
  baseline: { id: string; name: string };
  others: Array<{ id: string; name: string; parts: DiffPart[]; identical: boolean }>;
}

/** The first item is the baseline; every other item is diffed against it. */
export function compareDestinations(
  items: Array<{ id: string; name: string; text: string }>
): CompareResult {
  const [first, ...rest] = items;
  const base = normalize(first?.text ?? '');
  const others = rest.map((item) => {
    const identical = normalize(item.text) === base;
    return {
      id: item.id,
      name: item.name,
      identical,
      parts: identical
        ? ([{ text: item.text, kind: 'same' }] as DiffPart[])
        : diffWords(first.text, item.text),
    };
  });
  return {
    identical: others.every((o) => o.identical),
    baseline: { id: first?.id ?? '', name: first?.name ?? '' },
    others,
  };
}
