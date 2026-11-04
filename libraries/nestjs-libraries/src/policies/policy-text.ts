const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
};

const decodeEntities = (text: string): string =>
  text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (m, dec, hex, name) => {
    if (name !== undefined) return NAMED_ENTITIES[name] ?? m;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return m;
    return String.fromCodePoint(cp);
  });

const BLOCK_TAGS =
  'p|div|li|ul|ol|h[1-6]|blockquote|pre|tr|td|th|section|article';

export const htmlToPolicyText = (html: string): string => {
  let text = (html || '').replace(
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi,
    (_m, dq, sq) => ` ${dq ?? sq} `
  );
  // Block-level tags and <br> separate words; inline tags vanish so fr<b>ee</b> stays "free".
  text = text.replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>|<br\\b[^>]*>`, 'gi'), ' ');
  text = text.replace(/<[^>]*>/g, '');
  // Decode once, after tags are gone, so an entity cannot smuggle in a tag.
  text = decodeEntities(text);
  return text.replace(/\s+/g, ' ').trim().normalize('NFC');
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
    return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${body}(?![\\p{L}\\p{M}\\p{N}_])`, 'iu').test(haystack);
  });
};
