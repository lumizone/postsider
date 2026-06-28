/**
 * Pure mapping from the MCP `postsider_create_post` tool arguments to the
 * PostSider public API request body for `POST /public/v1/posts`.
 *
 * Kept as a standalone, dependency-free function so it can be unit-tested in
 * isolation (importing `index.ts` would start the stdio server and require
 * POSTSIDER_API_KEY). `index.ts` imports and uses this verbatim, so runtime
 * behavior is unchanged.
 */

/** A single media object as accepted by the create-post tool. */
export interface CreatePostMedia {
  id?: string;
  path: string;
  [key: string]: unknown;
}

/** One per-channel entry of the create-post tool input. */
export interface CreatePostEntry {
  channelId: string;
  content: string;
  firstComment?: string;
  images?: CreatePostMedia[];
  settings?: Record<string, unknown>;
}

/** A content tag. */
export interface CreatePostTag {
  value: string;
  label: string;
}

/** The full create-post tool input. */
export interface CreatePostArgs {
  type: 'draft' | 'schedule' | 'now';
  date: string;
  shortLink: boolean;
  posts: CreatePostEntry[];
  tags?: CreatePostTag[];
}

/** The public API request body for `POST /public/v1/posts`. */
export interface CreatePostBody {
  type: 'draft' | 'schedule' | 'now';
  date: string;
  shortLink: boolean;
  tags: CreatePostTag[];
  posts: Array<{
    integration: { id: string };
    value: Array<{ content: string; image: CreatePostMedia[] }>;
    firstComment?: string;
    settings: Record<string, unknown>;
  }>;
}

/**
 * Map the create-post tool arguments to the public API request body.
 * Defaults: `image` -> [], `settings` -> {}, `tags` -> []. `firstComment` is
 * only included when provided.
 */
export function buildCreatePostBody(args: CreatePostArgs): CreatePostBody {
  const { type, date, shortLink, posts, tags } = args;
  return {
    type,
    date,
    shortLink,
    tags: tags ?? [],
    posts: posts.map((p) => ({
      integration: { id: p.channelId },
      value: [{ content: p.content, image: p.images ?? [] }],
      ...(p.firstComment ? { firstComment: p.firstComment } : {}),
      settings: p.settings ?? {},
    })),
  };
}
