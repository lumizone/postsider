"use client";
import { api } from "@/lib/api";

export function getCommentProviders(): Promise<{ providers: string[] }> {
  return api.get("/posts/comment-providers");
}
