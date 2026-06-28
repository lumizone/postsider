"use client";

import { api } from "@/lib/api";

export type CheckResult = {
  score: number;
  dimensions: { hook: number; clarity: number; cta: number; platformFit: number };
  positives: string[];
  negatives: string[];
};

export type CheckResults = Record<string, CheckResult | { error: string }>;

export function checkPost(body: {
  content: string;
  hasMedia: boolean;
  mediaType?: "image" | "video" | "mixed";
  platforms: string[];
}): Promise<CheckResults> {
  return api.post<CheckResults>("/posts/check", body);
}

export type RewriteTone = "rephrase" | "shorten" | "formal" | "casual" | "punchy";
export type RewriteResult = { variants: string[] };

export function rewritePost(body: {
  content: string;
  tone?: RewriteTone;
  count?: number;
  platform?: string;
}): Promise<RewriteResult> {
  return api.post<RewriteResult>("/posts/rewrite", body);
}

// Cloud build: Post Checker + rewrite use the platform OpenAI key, so there is
// no per-org checker config endpoint (the OSS BYO-key flow was removed).
