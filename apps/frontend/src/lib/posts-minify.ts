/**
 * Frontend mirror of `libraries/helpers/src/utils/posts.list.minify.ts`.
 *
 * The backend transparently shrinks calendar / list responses to single-letter
 * keys to keep payloads small. We expand them on receipt so the rest of the
 * frontend can work with readable shapes. Keep this in sync with the backend
 * file when keys are added or renamed.
 */

const POST_LIST_KEYS: Record<string, string> = {
  posts: "p",
  total: "t",
  page: "pg",
  limit: "l",
  hasMore: "hm",
};

const POST_CALENDAR_KEYS: Record<string, string> = {
  posts: "p",
};

const POST_ITEM_KEYS: Record<string, string> = {
  id: "i",
  content: "c",
  publishDate: "d",
  releaseURL: "u",
  releaseId: "ri",
  state: "s",
  group: "g",
  tags: "tg",
  integration: "n",
  intervalInDays: "iv",
  actualDate: "ad",
  creationMethod: "cm",
};

const INTEGRATION_KEYS: Record<string, string> = {
  id: "i",
  providerIdentifier: "pi",
  name: "n",
  picture: "p",
};

const TAG_KEYS: Record<string, string> = {
  tag: "t",
};

const TAG_INNER_KEYS: Record<string, string> = {
  id: "i",
  name: "n",
  color: "c",
  orgId: "o",
  createdAt: "ca",
  updatedAt: "ua",
  deletedAt: "da",
};

function reverseMap(keyMap: Record<string, string>) {
  const reversed: Record<string, string> = {};
  for (const [k, v] of Object.entries(keyMap)) reversed[v] = k;
  return reversed;
}

function mapKeys(obj: Record<string, unknown>, keyMap: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[keyMap[k] || k] = v;
  }
  return out;
}

function expandPostItem(post: Record<string, unknown>) {
  const expanded = mapKeys(post, reverseMap(POST_ITEM_KEYS));
  if (expanded.integration && typeof expanded.integration === "object") {
    expanded.integration = mapKeys(
      expanded.integration as Record<string, unknown>,
      reverseMap(INTEGRATION_KEYS),
    );
  }
  if (Array.isArray(expanded.tags)) {
    expanded.tags = (expanded.tags as Record<string, unknown>[]).map((wrap) => {
      const w = mapKeys(wrap, reverseMap(TAG_KEYS));
      if (w.tag && typeof w.tag === "object") {
        w.tag = mapKeys(w.tag as Record<string, unknown>, reverseMap(TAG_INNER_KEYS));
      }
      return w;
    });
  }
  return expanded;
}

export function expandPostsList(data: unknown) {
  const expanded = mapKeys(
    (data as Record<string, unknown>) ?? {},
    reverseMap(POST_LIST_KEYS),
  );
  expanded.posts = (Array.isArray(expanded.posts)
    ? (expanded.posts as Record<string, unknown>[])
    : []
  ).map(expandPostItem);
  return expanded as unknown as {
    posts: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

export function expandPosts(data: unknown) {
  const expanded = mapKeys(
    (data as Record<string, unknown>) ?? {},
    reverseMap(POST_CALENDAR_KEYS),
  );
  expanded.posts = (Array.isArray(expanded.posts)
    ? (expanded.posts as Record<string, unknown>[])
    : []
  ).map(expandPostItem);
  return expanded as unknown as { posts: Record<string, unknown>[] };
}
