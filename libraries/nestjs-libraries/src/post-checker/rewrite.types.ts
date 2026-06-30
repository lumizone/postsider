export type RewriteTone =
  | 'rephrase'
  | 'shorten'
  | 'formal'
  | 'casual'
  | 'punchy';

export interface RewriteInput {
  content: string;
  tone?: RewriteTone;
  count?: number;
  platform?: string;
}

export interface RewriteResult {
  variants: string[];
}
