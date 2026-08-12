export interface BrandContext {
  voice?: string | null;
  audience?: string | null;
  rules?: string | null;
  forbiddenWords?: string | null;
}

const MAX_BRAND_CONTEXT_CHARS = 2000;

export function formatBrandContext(context?: BrandContext | null): string {
  if (!context) return '';
  const lines = [
    context.voice && `Brand voice: ${context.voice}`,
    context.audience && `Target audience: ${context.audience}`,
    context.rules && `Brand rules: ${context.rules}`,
    context.forbiddenWords && `Forbidden words or phrases: ${context.forbiddenWords}`,
  ].filter(Boolean);
  const formatted = lines.length ? `\nBRAND CONTEXT:\n${lines.join('\n')}` : '';
  return formatted.slice(0, MAX_BRAND_CONTEXT_CHARS);
}
