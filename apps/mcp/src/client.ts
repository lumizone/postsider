/**
 * Thin HTTP client for the PostSider public API (`/public/v1`).
 *
 * Auth is the RAW api key in the `Authorization` header (no `Bearer` prefix),
 * matching the platform's public API contract. This client has no dependency on
 * the backend; it talks to any PostSider instance (cloud or self-hosted) over
 * HTTP, so the MCP server works the same everywhere.
 */
export class PostsiderClient {
  private readonly base: string;

  constructor(private readonly apiKey: string, baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, '') + '/public/v1';
  }

  private async request(
    method: string,
    path: string,
    opts: { query?: Record<string, unknown>; body?: unknown } = {}
  ): Promise<unknown> {
    const url = new URL(this.base + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v));
        }
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: this.apiKey,
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      throw new Error(
        `Could not reach PostSider at ${url.origin}. Check POSTSIDER_API_URL and that the instance is online. (${
          err instanceof Error ? err.message : String(err)
        })`
      );
    }

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const apiMsg =
        data && typeof data === 'object' && 'msg' in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).msg)
          : typeof data === 'string'
          ? data
          : res.statusText;
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Unauthorized (${res.status}). The POSTSIDER_API_KEY is missing or invalid. Generate one in PostSider under Settings -> API.`
        );
      }
      throw new Error(
        `PostSider API ${method} ${path} failed (${res.status}): ${apiMsg}`
      );
    }

    return data;
  }

  get(path: string, query?: Record<string, unknown>) {
    return this.request('GET', path, { query });
  }
  post(path: string, body?: unknown) {
    return this.request('POST', path, { body });
  }
  put(path: string, body?: unknown) {
    return this.request('PUT', path, { body });
  }
  del(path: string) {
    return this.request('DELETE', path);
  }
}
