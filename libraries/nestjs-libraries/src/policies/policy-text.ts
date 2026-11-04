import { parseFragment } from 'parse5';

// Phrasing elements that do not separate words: fr<b>ee</b> reads as "free".
// Every other element (block, void like <hr>, custom) separates words.
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font',
  'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub',
  'sup', 'time', 'tt', 'u', 'var', 'wbr',
]);

type HtmlNode = {
  nodeName: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  content?: { childNodes?: HtmlNode[] };
};

export const POLICY_MAX_INPUT_CHARS = 200_000;
export const POLICY_MAX_TAGS = 5_000;

export class PolicyInputTooLargeError extends Error {
  readonly code = 'policy_input_too_large';
  /** Length of the rejected input in UTF-16 code units. */
  readonly length: number;
  constructor(length: number, message: string) {
    super(message);
    this.name = 'PolicyInputTooLargeError';
    this.length = length;
  }
}

const walkPolicyText = (root: HtmlNode): string[] => {
  const out: string[] = [];
  const stack: Array<HtmlNode | string> = [root];
  while (stack.length) {
    const item = stack.pop() as HtmlNode | string;
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (item.nodeName === '#comment') continue;
    if (item.nodeName === '#text') {
      out.push(item.value ?? '');
      continue;
    }
    const isElement = item.attrs !== undefined;
    const separates = isElement && !INLINE_TAGS.has(item.nodeName);
    if (separates) out.push(' ');
    if (isElement) {
      for (const attr of item.attrs ?? []) {
        if (attr.name === 'href' || attr.name === 'src') out.push(` ${attr.value} `);
      }
    }
    // Pushed in reverse so children pop in document order, the closing space last.
    if (separates) stack.push(' ');
    const kids = [...(item.childNodes ?? []), ...(item.content?.childNodes ?? [])];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
};

/**
 * Reduces post HTML to the text a reader would see, plus every href and src
 * value so links hidden in attributes are still detected. Parsing and entity
 * decoding are delegated to parse5 so they match a browser. Traversal is
 * iterative so deeply nested markup cannot overflow the call stack.
 * Throws PolicyInputTooLargeError above POLICY_MAX_INPUT_CHARS characters or POLICY_MAX_TAGS '<' characters,
 * and also when markup within both limits still exhausts the call stack inside parse5
 * (e.g. ~5000 nested <template>), so callers only ever see that one error and fail closed.
 */
export const htmlToPolicyText = (html: string): string => {
  const input = html || '';
  if (input.length > POLICY_MAX_INPUT_CHARS) {
    throw new PolicyInputTooLargeError(
      input.length,
      `Policy text input is ${input.length} characters, the limit is ${POLICY_MAX_INPUT_CHARS}`
    );
  }
  // parse5 is quadratic in nesting depth, so bound the markup count with an O(n) pre-scan.
  let tags = 0;
  for (let i = input.indexOf('<'); i !== -1; i = input.indexOf('<', i + 1)) {
    if (++tags > POLICY_MAX_TAGS) {
      throw new PolicyInputTooLargeError(
        input.length,
        `Policy text input has more than ${POLICY_MAX_TAGS} tags, the limit is ${POLICY_MAX_TAGS}`
      );
    }
  }

  let out: string[];
  try {
    out = walkPolicyText(parseFragment(input) as unknown as HtmlNode);
  } catch (e) {
    if (e instanceof RangeError) {
      throw new PolicyInputTooLargeError(
        input.length,
        `Policy text input nests too deeply to parse within the ${POLICY_MAX_TAGS} tag limit`
      );
    }
    throw e;
  }
  return out.join('').replace(/\s+/g, ' ').trim().normalize('NFC');
};

const TLDS =
  'com|net|org|io|co|pl|de|uk|eu|fr|es|it|nl|se|no|dk|fi|cz|sk|ru|ua|us|ca|au|app|dev|ai|ly|me|gl|to|be|ch|at|info|biz|xyz|online|site|store|tech';

// Every pattern must stay linear in the text length (inputs reach POLICY_MAX_INPUT_CHARS).
// A pattern may only start where its lookbehind or literal prefix proves a token start,
// and the runs it then scans cannot contain another allowed start, so the scanned
// regions of different start positions never overlap. The bare-domain lookbehind is
// Unicode-aware for that reason: with ASCII \w every position inside a run of non-ASCII
// letters was a new start that rescanned the rest of the run (quadratic).
const LINK_PATTERNS = [
  /\bhttps?:\/\/\S+/iu,
  /\bwww\.[\p{L}\p{N}-]+\.\S+/iu,
  new RegExp(
    `(?<![\\p{L}\\p{N}_@.-])[\\p{L}\\p{N}-]+(\\.[\\p{L}\\p{N}-]+)*\\.(${TLDS})\\b(?![\\p{L}\\p{N}-]*@)`,
    'iu'
  ),
];

export const containsLink = (text: string): boolean => {
  if (!text) return false;
  const t = text.normalize('NFC');
  return LINK_PATTERNS.some((re) => re.test(t));
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const MARK_CHAR = /\p{M}/u;
const AFTER_BLOCKER = /^[\p{L}\p{M}\p{N}_]/u;

/**
 * wordBefore[i] = 1 when the nearest non-mark code point before index i is a
 * letter, digit or underscore. One O(n) pass replaces the variable-length
 * lookbehind (?<![\p{L}\p{N}_]\p{M}*), which rescanned mark runs at every position.
 */
const wordCharBefore = (text: string): Uint8Array => {
  const before = new Uint8Array(text.length + 1);
  let prevIsWord = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    before[i] = prevIsWord;
    if (ch.length === 2) before[i + 1] = prevIsWord;
    if (!MARK_CHAR.test(ch)) prevIsWord = WORD_CHAR.test(ch) ? 1 : 0;
    i += ch.length;
  }
  before[text.length] = prevIsWord;
  return before;
};

/**
 * Whole-word, case-insensitive match of any entry. Each entry is compiled once per
 * call into a pure literal (whitespace in the text and in the entry is collapsed to a
 * single space first), and word boundaries are checked in O(1) per candidate from a
 * precomputed table, so the cost is one literal scan of the text per entry.
 */
export const containsAnyWord = (text: string, words: string[]): boolean => {
  if (!text) return false;
  const haystack = text.normalize('NFC').replace(/\s+/gu, ' ');
  let before: Uint8Array | undefined;
  for (const word of words) {
    const trimmed = word.trim().normalize('NFC');
    if (!trimmed) continue;
    const re = new RegExp(trimmed.split(/\s+/u).map(escapeRegExp).join(' '), 'giu');
    before ??= wordCharBefore(haystack);
    for (let m = re.exec(haystack); m; m = re.exec(haystack)) {
      const end = m.index + m[0].length;
      if (!before[m.index] && !AFTER_BLOCKER.test(haystack.slice(end, end + 2))) return true;
      // Retry one code point later so overlapping candidates are not skipped.
      re.lastIndex = m.index + ((haystack.codePointAt(m.index) as number) > 0xffff ? 2 : 1);
    }
  }
  return false;
};
