const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/g, ' '],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&amp;/g, '&'],
];

export const htmlToPolicyText = (html: string): string => {
  let text = (html || '').replace(
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi,
    (_m, dq, sq) => ` ${dq ?? sq} `
  );
  text = text.replace(/<[^>]*>/g, ' ');
  for (const [re, rep] of ENTITIES) text = text.replace(re, rep);
  return text.replace(/\s+/g, ' ').trim();
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

export const containsLink = (text: string): boolean =>
  !!text && LINK_PATTERNS.some((re) => re.test(text));

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const containsAnyWord = (text: string, words: string[]): boolean => {
  if (!text) return false;
  return words.some((word) => {
    const trimmed = word.trim();
    if (!trimmed) return false;
    const body = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
  });
};
