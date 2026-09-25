/**
 * The PostSider public API client: base URL validation, bounded requests, and
 * actionable errors. `server.ts` builds one per request from the organization
 * API key.
 */
/**
 * Hosts allowed to use plain HTTP: loopback only, for local development and
 * self-hosting. `URL.hostname` keeps the brackets on an IPv6 literal.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validate `POSTSIDER_API_URL` and normalize it to the `<base>/public/v1` prefix.
 *
 * The public API is served over HTTPS. Plain HTTP is accepted only on loopback,
 * and credentials embedded in the URL are always rejected. Every message names
 * POSTSIDER_API_URL so the user knows which setting to fix, and none of them
 * includes the rejected URL, so an embedded password can never reach a log.
 */
function resolveBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(
      'POSTSIDER_API_URL is not a valid absolute URL. Use e.g. https://api.postsider.com.'
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      'POSTSIDER_API_URL must not embed credentials (username or password). ' +
        'Remove them and pass the key as POSTSIDER_API_KEY instead.'
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      `POSTSIDER_API_URL must use http or https, not "${parsed.protocol.replace(
        ':',
        ''
      )}". Use e.g. https://api.postsider.com.`
    );
  }

  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `POSTSIDER_API_URL must use https for non-local host "${parsed.hostname}". ` +
        'Plain http is allowed only for local development on localhost, 127.0.0.1 or [::1].'
    );
  }

  return (
    parsed.origin + parsed.pathname.replace(/\/+$/, '') + '/public/v1'
  );
}

/** Hard ceiling on how long a single API request may take. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Hard ceiling on how much of a failing response body is read or echoed. */
const MAX_ERROR_BODY_BYTES = 8 * 1024;

/**
 * Hard ceiling on a successful response body. Tool results are injected into the
 * agent's context, so an unbounded payload is a problem regardless of who causes
 * it. 8 MB is far beyond any sane calendar response.
 */
const MAX_RESPONSE_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Read `name` off a thrown value without relying on the Error prototype chain.
 * A `DOMException` cross-realm value is not always `instanceof Error`, so
 * classifying by prototype silently misroutes timeouts to the generic branch.
 */
function thrownName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    return String((err as { name: unknown }).name);
  }
  return '';
}

/**
 * Read a message off a thrown value's `cause`, which is where the runtime puts
 * the real reason for a failed `fetch` (for example "unexpected redirect").
 *
 * Read structurally, never with `instanceof`: inside a test runner's VM the
 * cause can come from another realm, which is the same trap `thrownName` exists
 * to avoid.
 */
function thrownCauseMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'cause' in err) {
    const cause = (err as { cause: unknown }).cause;
    if (typeof cause === 'string') {
      return cause;
    }
    if (typeof cause === 'object' && cause !== null && 'message' in cause) {
      return String((cause as { message: unknown }).message);
    }
  }
  return '';
}

/** Parse a JSON body, falling back to raw text when it is not JSON. */
function parseBody(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Read a response body without ever buffering more than `maxBytes`.
 *
 * The download is aborted as soon as the ceiling is passed, so a broken or
 * hostile server cannot stream unbounded data into the agent's context. The loop
 * reads one chunk past the ceiling before deciding, so a body of exactly
 * `maxBytes` is not falsely reported as truncated, and the over-read is bounded
 * to that single chunk.
 *
 * Bodies without a stream reader (test doubles, bodiless responses) cannot be
 * streamed at all, so they are read and then cut with the same byte ceiling.
 */
async function readBoundedBody(
  res: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const encoder = new TextEncoder();

  if (!res.body) {
    const text = await res.text();
    const bytes = encoder.encode(text);
    if (bytes.byteLength <= maxBytes) {
      return { text, truncated: false };
    }
    return {
      text: new TextDecoder().decode(bytes.subarray(0, maxBytes)),
      truncated: true,
    };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      seen += value.byteLength;
      chunks.push(value);
      if (seen > maxBytes) {
        truncated = true;
        break;
      }
    }
  } finally {
    // Release the connection even when we stopped reading early.
    await reader.cancel().catch(() => undefined);
  }

  const all = new Uint8Array(seen);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Cut the BYTES, not the decoded string, so the ceiling stays exact.
  const bytes = truncated ? all.subarray(0, maxBytes) : all;
  return { text: new TextDecoder().decode(bytes), truncated };
}

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
    this.base = resolveBaseUrl(baseUrl);
  }

  private async request(
    method: string,
    path: string,
    opts: { query?: Record<string, unknown>; body?: unknown; idempotencyKey?: string } = {}
  ): Promise<unknown> {
    if (!path.startsWith('/')) {
      // Internal invariant: every path in server.ts is a literal starting with "/".
      throw new Error(
        `Internal error: API paths must start with "/", received "${path}".`
      );
    }

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
          ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // The public API never legitimately redirects, and a redirect would
        // otherwise leave the validated origin: the HTTPS/loopback policy above
        // only covers the URL the user configured, not wherever it points next.
        redirect: 'error',
      });
    } catch (err) {
      const name = thrownName(err);
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(
          `PostSider did not respond within ${
            REQUEST_TIMEOUT_MS / 1000
          }s (${method} ${path} at ${url.origin}). Check POSTSIDER_API_URL and that the instance is online.`
        );
      }
      // This client refuses redirects on purpose (see `redirect: 'error'`), so a
      // redirected request would otherwise surface as an opaque "fetch failed".
      if (thrownCauseMessage(err).toLowerCase().includes('redirect')) {
        throw new Error(
          `PostSider answered ${method} ${path} with a redirect, which this client refuses to follow ` +
            `because it would send the API key to another address. Point POSTSIDER_API_URL directly at the ` +
            `PostSider API (self-hosted installs behind the bundled nginx need the /api suffix, e.g. https://social.example.com/api).`
        );
      }
      throw new Error(
        `Could not reach PostSider at ${url.origin}. Check POSTSIDER_API_URL and that the instance is online. (${
          err instanceof Error ? err.message : String(err)
        })`
      );
    }

    /**
     * Read the body, turning an abort that happens mid-response into the same
     * timeout message instead of leaking a raw DOMException to the agent.
     */
    const readBody = async (maxBytes: number) => {
      try {
        return await readBoundedBody(res, maxBytes);
      } catch (err) {
        const name = thrownName(err);
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new Error(
            `PostSider did not finish sending its response within ${
              REQUEST_TIMEOUT_MS / 1000
            }s (${method} ${path} at ${url.origin}). Check POSTSIDER_API_URL and that the instance is online.`
          );
        }
        throw new Error(
          `PostSider API ${method} ${path} response could not be read: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    };

    if (!res.ok) {
      const { text: raw, truncated } = await readBody(MAX_ERROR_BODY_BYTES);
      const data = parseBody(truncated ? `${raw} [truncated]` : raw);
      const apiMsg =
        data && typeof data === 'object' && 'msg' in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).msg)
          : typeof data === 'string'
          ? data
          : res.statusText;
      // 423 = Emergency Pause (kill switch): surface WHY the post did not go
      // out so an agent understands a paused org instead of a generic failure.
      if (res.status === 423) {
        const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const reason = typeof d.reason === 'string' ? d.reason : undefined;
        throw new Error(
          `Publishing is paused for this organization${
            reason ? ` (${reason})` : ''
          }. No posts can be scheduled or published until an owner resumes from the PostSider dashboard.`
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Unauthorized (${res.status}). The POSTSIDER_API_KEY is missing or invalid. Generate one in PostSider under Settings -> API.`
        );
      }
      throw new Error(
        `PostSider API ${method} ${path} failed (${res.status}): ${apiMsg}`
      );
    }

    // A successful body is agent-visible payload, so it is bounded too: without
    // a ceiling a broken instance could exhaust memory on the user's machine.
    const { text, truncated } = await readBody(MAX_RESPONSE_BODY_BYTES);
    if (truncated) {
      throw new Error(
        `PostSider API ${method} ${path} returned more than ${
          MAX_RESPONSE_BODY_BYTES / (1024 * 1024)
        } MB, which is more than this server will load. Narrow the request, for example with a shorter date range.`
      );
    }
    return parseBody(text);
  }

  get(path: string, query?: Record<string, unknown>) {
    return this.request('GET', path, { query });
  }
  post(path: string, body?: unknown, idempotencyKey?: string) {
    return this.request('POST', path, { body, idempotencyKey });
  }
  put(path: string, body?: unknown) {
    return this.request('PUT', path, { body });
  }
  del(path: string) {
    return this.request('DELETE', path);
  }
}
