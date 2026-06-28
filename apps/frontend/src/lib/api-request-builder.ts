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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildPostBody(input: BuildPostInput): Record<string, unknown> {
  const image = input.image
    ? [
        {
          id: input.image.id,
          path: input.image.path,
          alt: input.image.alt ?? null,
          thumbnail: input.image.thumbnail ?? null,
          thumbnailTimestamp: null,
        },
      ]
    : [];

  return {
    type: input.type ?? "schedule",
    tags: [],
    shortLink: false,
    date: input.date,
    posts: [
      {
        integration: { id: input.integrationId },
        group: input.group,
        settings: input.settings ?? {},
        value: [
          {
            id: input.valueId,
            content: `<p>${escapeHtml(input.content)}</p>`,
            delay: 0,
            image,
          },
        ],
      },
    ],
  };
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
