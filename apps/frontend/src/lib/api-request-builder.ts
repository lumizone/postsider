// Pure builder for the Settings -> API "Request generator". Produces the JSON
// body and a copyable curl for POST /public/v1/posts. No React / DOM so it can
// be unit-tested in isolation.

export interface RequestImage {
  id: string;
  path: string;
  alt?: string | null;
  thumbnail?: string | null;
}

export interface BuildPostInput {
  integrationId: string;
  content: string;
  date: string; // ISO, e.g. "2026-06-27T20:02:31"
  type?: "schedule" | "now" | "draft";
  settings?: Record<string, unknown>;
  image?: RequestImage | null;
  group: string;
  valueId: string;
}

/** One selected channel in a multi-channel request. */
export interface BuildPostChannel {
  integrationId: string;
  settings?: Record<string, unknown>;
  valueId: string;
}

export interface BuildMultiPostInput {
  channels: BuildPostChannel[];
  content: string;
  date: string; // ISO, e.g. "2026-06-27T20:02:31"
  type?: "schedule" | "now" | "draft";
  image?: RequestImage | null;
  group: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function imageArray(image?: RequestImage | null) {
  return image
    ? [
        {
          id: image.id,
          path: image.path,
          alt: image.alt ?? null,
          thumbnail: image.thumbnail ?? null,
          thumbnailTimestamp: null,
        },
      ]
    : [];
}

/**
 * Multi-channel body: one entry in `posts[]` per selected channel (all sharing
 * the same group, content, date and media — exactly like the calendar composer
 * publishing one post across several channels).
 */
export function buildMultiPostBody(
  input: BuildMultiPostInput
): Record<string, unknown> {
  const image = imageArray(input.image);
  const content = `<p>${escapeHtml(input.content)}</p>`;
  return {
    type: input.type ?? "schedule",
    tags: [],
    shortLink: false,
    date: input.date,
    posts: input.channels.map((ch) => ({
      integration: { id: ch.integrationId },
      group: input.group,
      settings: ch.settings ?? {},
      value: [{ id: ch.valueId, content, delay: 0, image }],
    })),
  };
}

export function buildPostBody(input: BuildPostInput): Record<string, unknown> {
  return buildMultiPostBody({
    channels: [
      {
        integrationId: input.integrationId,
        settings: input.settings,
        valueId: input.valueId,
      },
    ],
    content: input.content,
    date: input.date,
    type: input.type,
    image: input.image,
    group: input.group,
  });
}

export function buildJson(body: Record<string, unknown>): string {
  return JSON.stringify(body, null, 2);
}

// The public API authenticates on the RAW Authorization header value (no
// "Bearer" prefix). The real key cannot be injected (hashed, shown once), so a
// placeholder is used.
export function buildCurl(body: Record<string, unknown>, baseUrl: string): string {
  const inline = JSON.stringify(body).replace(/'/g, "'\\''");
  return [
    `curl -X POST '${baseUrl}/public/v1/posts' \\`,
    `  -H 'Authorization: ps_YOUR_API_KEY' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${inline}'`,
  ].join("\n");
}
