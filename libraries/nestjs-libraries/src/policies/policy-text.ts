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

/**
 * Reduces post HTML to the text a reader would see, plus every href and src
 * value so links hidden in attributes are still detected. Parsing and entity
 * decoding are delegated to parse5 so they match a browser.
 */
export const htmlToPolicyText = (html: string): string => {
  const out: string[] = [];
  const walk = (node: HtmlNode) => {
    if (node.nodeName === '#comment') return;
    if (node.nodeName === '#text') {
      out.push(node.value ?? '');
      return;
    }
    const isElement = node.attrs !== undefined;
    const separates = isElement && !INLINE_TAGS.has(node.nodeName);
    if (separates) out.push(' ');
    if (isElement) {
      for (const attr of node.attrs ?? []) {
        if (attr.name === 'href' || attr.name === 'src') out.push(` ${attr.value} `);
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
    for (const child of node.content?.childNodes ?? []) walk(child);
    if (separates) out.push(' ');
  };
  walk(parseFragment(html || '') as unknown as HtmlNode);
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
