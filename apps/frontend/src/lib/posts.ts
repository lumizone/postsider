/**
 * Posts API client.
 *
 * Two endpoints feed the UI:
 * - GET /posts?startDate=&endDate=  — calendar / minified, returns posts
 *   in the given range, expanded back to readable shape via expandPosts.
 * - GET /posts/list?page=&limit=&state= — Posts page (paginated).
 *
 * Backend response is minified (single-letter keys) — we expand using the
 * same helper the backend uses.
 *
 * Re-exporting the helper makes it discoverable to anyone digging into this
 * file.
 */

import { api } from "./api";
import { expandPosts, expandPostsList } from "./posts-minify";

/**
 * Upload a media file (image/video) to the backend and return its public
 * path/URL, usable as a media source when creating a post. Providers like
 * Instagram require a publicly reachable media URL.
 */
export async function uploadMedia(
  file: File | Blob,
  fileName?: string,
): Promise<{ id?: string; path: string }> {
  const form = new FormData();
  form.append("file", file, fileName || (file as File).name || "upload");
  const res = await api.upload<{ id?: string; path: string }>(
    "/media/upload-simple",
    form,
  );
  return { id: res.id, path: res.path };
}

export type BackendPostState = "QUEUE" | "PUBLISHED" | "ERROR" | "DRAFT" | "APPROVAL";

/** One media attachment as it appears inside a post's `image` JSON column. */
export interface PostMedia {
  id?: string;
  /** Publicly reachable URL (absolute), resolved from path when relative. */
  url: string;
  kind: "image" | "video";
}

/**
 * Parse the `Post.image` column (JSON string of `[{id, path, url?, type?}]`)
 * into renderable media entries. Handles both the raw stored shape (id+path
 * only, e.g. posts created via the public API) and the enriched shape the
 * detail endpoint returns (path+url+type+name). Returns [] for null/empty/
 * unparseable input so callers can render a plain text row safely.
 */
export function parsePostMedia(
  image: string | PostMedia[] | { id?: string; path?: string; url?: string; type?: string }[] | null | undefined,
): PostMedia[] {
  if (!image) return [];
  let arr: { id?: string; path?: string; url?: string; type?: string }[];
  if (typeof image === "string") {
    try {
      arr = JSON.parse(image);
    } catch {
      return [];
    }
  } else {
    arr = image;
  }
  if (!Array.isArray(arr)) return [];
  const base = (
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const resolve = (p?: string): string => {
    if (!p) return "";
    if (/^https?:\/\//i.test(p)) return p;
    if (p.startsWith("/")) return base + p;
    return `${base}/uploads/${p}`;
  };
  return arr
    .map((m) => {
      const raw = m?.path || m?.url;
      if (!raw) return null;
      const url = resolve(raw);
      const lower = url.toLowerCase();
      const isVideo =
        m?.type === "video" ||
        m?.type === "audio" ||
        /\.(mp4|webm|mov|mkv|m4v|avi|mpeg)(\?|#|$)/.test(lower);
      return { id: m?.id, url, kind: isVideo ? "video" : "image" } as PostMedia;
    })
    .filter((m): m is PostMedia => m !== null);
}

export interface BackendPost {
  id: string;
  content: string;
  publishDate: string;
  releaseURL: string | null;
  releaseId: string | null;
  state: BackendPostState;
  intervalInDays: number | null;
  group: string;
  creationMethod: string;
  actualDate?: string;
  /** JSON string of the post's media attachments (see parsePostMedia). */
  image?: string | null;
  tags?: { tag: { id: string; name: string; color: string } }[];
  integration: {
    id: string;
    providerIdentifier: string;
    name: string;
    picture: string | null;
  };
}

export interface PostsListResponse {
  posts: BackendPost[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export async function fetchCalendarPosts(
  startDate: string,
  endDate: string,
  customer?: string,
): Promise<BackendPost[]> {
  const minified = await api.get<unknown>("/posts", {
    startDate,
    endDate,
    customer,
  });
  const expanded = expandPosts(minified);
  return (expanded.posts as unknown as BackendPost[]) || [];
}

export async function fetchPostsList(params: {
  page?: number;
  limit?: number;
  state?:
    | "all"
    | "scheduled"
    | "draft"
    | "published"
    | "failed"
    | "approval";
}): Promise<PostsListResponse> {
  const minified = await api.get<unknown>("/posts/list", {
    page: params.page ?? 0,
    limit: params.limit ?? 50,
    state: params.state ?? "all",
  });
  return expandPostsList(minified) as unknown as PostsListResponse;
}

export async function deletePostGroup(group: string): Promise<void> {
  await api.del(`/posts/${group}`);
}

export async function changePostDate(
  id: string,
  isoDate: string,
  action: "schedule" | "update" = "schedule",
): Promise<void> {
  await api.put(`/posts/${id}/date`, { date: isoDate, action });
}

/**
 * Build the create-post payload from the lightweight UI shape used in the
 * composer. We default to type=schedule when scheduling, type=draft when
 * saving a draft.
 *
 * The backend expects one entry in `posts[]` per channel — each with at
 * least one PostContent in `value[]`. Per-channel content lives in
 * `perChannelBody`; the global `body` is used as a fallback.
 */
export interface CreatePostInput {
  type: "schedule" | "draft" | "now" | "update";
  /** ISO date including time, in UTC. */
  date: string;
  channelIds: string[];
  body: string;
  perChannelBody: Record<string, string>;
  threadParts: string[];
  /** Optional comment posted right after the main post (provider-gated). */
  firstComment?: string;
  media: { id: string; path: string }[];
  shortLink?: boolean;
  tags?: { value: string; label: string }[];
  /**
   * Per-channel provider settings, keyed by integration id. e.g. Discord
   * requires `{ channel: "<channelId>" }`. Merged into each post's settings.
   */
  perChannelSettings?: Record<string, Record<string, unknown>>;
  /**
   * When editing an existing post, the group id to update. Sent so the
   * backend updates in place instead of creating new posts.
   */
  group?: string;
}

export async function createPost(
  input: CreatePostInput,
): Promise<Array<{ postId: string; integration: string }>> {
  const group = input.group || "";
  const posts = input.channelIds.map((cid) => {
    const main = input.perChannelBody[cid] ?? input.body;
    const value = [
      {
        content: main,
        image: input.media,
      },
      // Thread parts apply to every channel — providers that don't support
      // threads simply ignore everything past the first item.
      ...input.threadParts.map((part) => ({
        content: part,
        image: [] as { id: string; path: string }[],
      })),
    ];

    return {
      integration: { id: cid },
      value,
      // Optional first comment rides along per post; the backend reads it
      // per-post and only honors it for providers that support comments.
      ...(input.firstComment ? { firstComment: input.firstComment } : {}),
      // Provider-specific settings (e.g. Discord channel) merged in per
      // channel. The backend resolves the __type discriminator server-side.
      settings: {
        __type: "empty",
        ...(input.perChannelSettings?.[cid] ?? {}),
      },
      group,
    };
  });

  return api.post<Array<{ postId: string; integration: string }>>("/posts", {
    type: input.type,
    date: input.date,
    shortLink: input.shortLink ?? false,
    tags: input.tags ?? [],
    posts,
  });
}

/** Single post in a group as returned by GET /posts/:id. */
export interface PostDetailItem {
  id: string;
  content: string;
  image?: PostMedia[];
}

export interface PostDetail {
  group: string;
  integration: string;
  settings: Record<string, unknown>;
  posts: PostDetailItem[];
  publishDate?: string;
}

/**
 * Fetch the full detail of a post (by its post id) for preview / edit
 * prefill. Returns the group, the owning integration, settings, and the
 * ordered content chain (main post + thread parts).
 */
export async function fetchPostDetail(id: string): Promise<PostDetail> {
  const res = await api.get<{
    group: string;
    integration: string;
    settings: Record<string, unknown>;
    posts: {
      content: string;
      image?: string | { id?: string; path: string }[];
      publishDate?: string;
    }[];
  }>(`/posts/${id}`);

  const posts: PostDetailItem[] = (res.posts ?? []).map((p) => ({
    id,
    content: p.content ?? "",
    image: parsePostMedia(p.image),
  }));

  return {
    group: res.group,
    integration: res.integration,
    settings: res.settings ?? {},
    posts,
    publishDate: res.posts?.[0]?.publishDate,
  };
}

export interface DuplicatePostInput {
  /** Target channel ID — if omitted, duplicates to the same channel. */
  targetIntegrationId?: string;
  /** ISO date for the duplicate — defaults to tomorrow if omitted. */
  date?: string;
}

export interface DuplicatePostResult {
  duplicated: boolean;
  source: { group: string; integration: string };
  target: {
    // Resolved from the newly created row; theoretically null only if that
    // row could not be re-fetched immediately after creation.
    group: string | null;
    postId: string;
    integration: string;
  };
}

/**
 * Duplicate a post group as a new draft.
 * Can optionally target a different channel.
 */
export async function duplicatePost(
  group: string,
  input?: DuplicatePostInput,
): Promise<DuplicatePostResult> {
  return api.post<DuplicatePostResult>(
    `/posts/group/${group}/duplicate`,
    input ?? {},
  );
}
