/**
 * Per-post detail: team comments + per-post analytics breakdown.
 * Both endpoints already existed server-side with zero frontend caller.
 */
import { api } from "./api";

export interface PostComment {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string | null; email: string } | null;
}

export function getPostComments(postId: string): Promise<PostComment[]> {
  return api.get<PostComment[]>(`/posts/${postId}/comments`);
}

export function addPostComment(postId: string, comment: string): Promise<PostComment> {
  return api.post<PostComment>(`/posts/${postId}/comments`, { comment });
}

export interface PostAnalyticsPoint {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange: number;
}

export type PostAnalyticsResponse =
  | PostAnalyticsPoint[]
  | { missing: true };

export function getPostAnalytics(postId: string): Promise<PostAnalyticsResponse> {
  return api.get<PostAnalyticsResponse>(`/analytics/post/${postId}`);
}
