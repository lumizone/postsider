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
  brandContext?: BrandContext;
}

export interface RewriteResult {
  variants: string[];
}
import type { BrandContext } from './brand-context';
