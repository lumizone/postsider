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

export const POLICY_MAX_INPUT_CHARS = 1_000_000;

export class PolicyInputTooLargeError extends Error {
  readonly code = 'policy_input_too_large';
  constructor(public readonly length: number) {
    super(`Policy text input is ${length} characters, the limit is ${POLICY_MAX_INPUT_CHARS}`);
    this.name = 'PolicyInputTooLargeError';
  }
}

/**
 * Reduces post HTML to the text a reader would see, plus every href and src
 * value so links hidden in attributes are still detected. Parsing and entity
 * decoding are delegated to parse5 so they match a browser. Traversal is
 * iterative so deeply nested markup cannot overflow the call stack.
 * Throws PolicyInputTooLargeError above POLICY_MAX_INPUT_CHARS.
 */
export const htmlToPolicyText = (html: string): string => {
  const input = html || '';
  if (input.length > POLICY_MAX_INPUT_CHARS) throw new PolicyInputTooLargeError(input.length);

  const out: string[] = [];
  const stack: Array<HtmlNode | string> = [parseFragment(input) as unknown as HtmlNode];
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
  return out.join('').replace(/\s+/g, ' ').trim().normalize('NFC');
};

const TLDS =
  'com|net|org|io|co|pl|de|uk|eu|fr|es|it|nl|se|no|dk|fi|cz|sk|ru|ua|us|ca|au|app|dev|ai|ly|me|gl|to|be|ch|at|info|biz|xyz|online|site|store|tech';

const LINK_PATTERNS = [
  /\bhttps?:\/\/\S+/iu,
  /\bwww\.[\p{L}\p{N}-]+\.\S+/iu,
  new RegExp(
    `(?<![@\\w.-])[\\p{L}\\p{N}-]+(\\.[\\p{L}\\p{N}-]+)*\\.(${TLDS})\\b(?![\\p{L}\\p{N}-]*@)`,
    'iu'
  ),
];

export const containsLink = (text: string): boolean => {
  if (!text) return false;
  const t = text.normalize('NFC');
  return LINK_PATTERNS.some((re) => re.test(t));
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const containsAnyWord = (text: string, words: string[]): boolean => {
  if (!text) return false;
  const haystack = text.normalize('NFC');
  return words.some((word) => {
    const trimmed = word.trim().normalize('NFC');
    if (!trimmed) return false;
    const body = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}_]\\p{M}*)${body}(?![\\p{L}\\p{M}\\p{N}_])`, 'iu').test(haystack);
  });
};
