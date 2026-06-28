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

export function getCheckerConfig(): Promise<{ provider: string | null; model: string | null }> {
  return api.get<{ provider: string | null; model: string | null }>("/settings/post-checker");
}

export function saveCheckerConfig(body: { provider: string; model: string; apiKey: string }) {
  return api.post("/settings/post-checker", body);
}

export function deleteCheckerConfig() {
  return api.del("/settings/post-checker");
}
