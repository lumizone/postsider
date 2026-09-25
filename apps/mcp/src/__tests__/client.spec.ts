import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PostsiderClient } from '../client.js';

/**
 * The runtime's real fetch, captured before any hook replaces it. The redirect
 * test needs actual network behaviour, not a mock.
 */
const REAL_FETCH = globalThis.fetch;

/** Listen on an ephemeral loopback port and resolve once bound. */
function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Build a mock Response-like object accepted by the client's request(). */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  text: string;
}): Response {
  const { ok = true, status = 200, statusText = 'OK', text } = opts;
  return {
    ok,
    status,
    statusText,
    text: async () => text,
  } as unknown as Response;
}

/** Build a mock Response whose body is a real byte stream. */
function mockStreamResponse(opts: {
  status: number;
  statusText?: string;
  chunks: string[];
  ok?: boolean;
}): Response {
  const {
    status,
    statusText = 'Internal Server Error',
    chunks,
    ok = status >= 200 && status < 300,
  } = opts;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return {
    ok,
    status,
    statusText,
    body,
    text: async () => chunks.join(''),
  } as unknown as Response;
}

describe('PostsiderClient', () => {
  const apiKey = 'test-api-key-123';
  let fetchMock: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    fetchMock = jest.fn();
    // global fetch is the only network surface the client touches.
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Constructor URL validation.
  //
  // The public API requires HTTPS. Plain HTTP is permitted only for explicitly
  // local development / self-hosting, and credentials embedded in the URL are
  // always rejected. Validation belongs in the constructor so a misconfigured
  // POSTSIDER_API_URL fails before any network call is attempted.
  //
  // Every rejection message must name POSTSIDER_API_URL so the user knows which
  // setting to correct, and must never echo the credential it rejected.
  // ───────────────────────────────────────────────────────────────────────────
  describe('URL validation', () => {
    /** Assert the constructor refuses `baseUrl`, naming the env var to fix. */
    function expectRejects(baseUrl: string, messagePattern?: RegExp): void {
      const build = () => new PostsiderClient(apiKey, baseUrl);
      expect(build).toThrow(/POSTSIDER_API_URL/);
      if (messagePattern) {
        expect(build).toThrow(messagePattern);
      }
    }

    const credentialPattern = /credential|username|password|userinfo/i;

    it('never leaks the API key into a validation error', () => {
      const rejectedUrls = [
        'ftp://api.postsider.com',
        'https://user:pass@api.postsider.com',
        'http://api.postsider.com',
        'not a url',
      ];

      for (const baseUrl of rejectedUrls) {
        let raised: unknown;
        try {
          new PostsiderClient('super-secret-key', baseUrl);
        } catch (err) {
          raised = err;
        }

        // Assert it threw at all: a constructor that stopped validating would
        // leave this undefined and the leak check would pass vacuously.
        expect(raised).toBeInstanceOf(Error);
        expect((raised as Error).message).not.toContain('super-secret-key');
      }
    });

    describe('unsupported protocols', () => {
      it('rejects ftp://', () => {
        expectRejects('ftp://api.postsider.com', /https/i);
      });

      it('rejects file://', () => {
        expectRejects('file:///etc/passwd', /https/i);
      });

      it('rejects ws://', () => {
        expectRejects('ws://api.postsider.com', /https/i);
      });

      it('rejects a value that is not a URL at all', () => {
        expectRejects('api.postsider.com');
      });

      it('rejects an empty base URL', () => {
        expectRejects('');
      });

      it('accepts a case-insensitive HTTPS scheme', () => {
        expect(
          () => new PostsiderClient(apiKey, 'HTTPS://api.postsider.com')
        ).not.toThrow();
      });
    });

    describe('embedded credentials', () => {
      it('rejects a username and password', () => {
        expectRejects(
          'https://user:sup3r-s3cret@api.postsider.com',
          credentialPattern
        );
      });

      it('rejects a username without a password', () => {
        expectRejects('https://user@api.postsider.com', credentialPattern);
      });

      it('never echoes the rejected password in the error', () => {
        const secret = 'sup3r-s3cret';
        let raised: unknown;
        try {
          new PostsiderClient(
            apiKey,
            `https://user:${secret}@api.postsider.com`
          );
        } catch (err) {
          raised = err;
        }

        expect(raised).toBeInstanceOf(Error);
        expect((raised as Error).message).toMatch(/POSTSIDER_API_URL/);
        expect((raised as Error).message).not.toContain(secret);
      });

      it('rejects credentials even on an otherwise approved local host', () => {
        expectRejects('http://user:pass@localhost:3000', credentialPattern);
      });
    });

    describe('plain HTTP on a public host', () => {
      it('rejects a public hostname', () => {
        expectRejects('http://api.postsider.com', /https/i);
      });

      it('rejects a public hostname with a port', () => {
        expectRejects('http://api.postsider.com:8080', /https/i);
      });

      it('rejects a public IP address', () => {
        expectRejects('http://93.184.216.34', /https/i);
      });
    });

    describe('plain HTTP on a local host', () => {
      it('allows http://localhost for local development', async () => {
        fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
        const client = new PostsiderClient(apiKey, 'http://localhost:3000');
        await client.get('/integrations');

        const url = fetchMock.mock.calls[0][0] as URL;
        expect(url.toString()).toBe(
          'http://localhost:3000/public/v1/integrations'
        );
      });

      it('allows http://127.0.0.1 for local development', async () => {
        fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
        const client = new PostsiderClient(apiKey, 'http://127.0.0.1:3000');
        await client.get('/integrations');

        const url = fetchMock.mock.calls[0][0] as URL;
        expect(url.toString()).toBe(
          'http://127.0.0.1:3000/public/v1/integrations'
        );
      });

      it('allows IPv6 loopback http://[::1] for local development', async () => {
        fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
        const client = new PostsiderClient(apiKey, 'http://[::1]:3000');
        await client.get('/integrations');

        const url = fetchMock.mock.calls[0][0] as URL;
        expect(url.toString()).toBe('http://[::1]:3000/public/v1/integrations');
      });

      it('still normalizes trailing slashes on an approved local host', async () => {
        fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
        const client = new PostsiderClient(apiKey, 'http://localhost:3000///');
        await client.get('/posts');

        const url = fetchMock.mock.calls[0][0] as URL;
        expect(url.toString()).toBe('http://localhost:3000/public/v1/posts');
      });
    });
    // Cases a substring check would get wrong: the loopback rule must match the
    // hostname exactly, and credentials must be rejected before it, otherwise a
    // URL can look local while the request goes somewhere else.
    // The expected reason is asserted per case, so a rejection for the wrong
    // reason does not satisfy the test.
    const mustReject: [string, string, RegExp][] = [
      ['HTTP://api.postsider.com', 'uppercase plain HTTP to a public host', /https/i],
      ['http://localhost.evil.com', 'a hostname that merely contains localhost', /https/i],
      ['http://127.0.0.1.evil.com', 'a hostname that merely contains the loopback IP', /https/i],
      ['http://localhost:3000@evil.com', 'loopback in userinfo with the real host elsewhere', credentialPattern],
      ['http://127.0.0.1@evil.com', 'loopback as username with the real host elsewhere', credentialPattern],
      ['file://localhost/etc/passwd', 'a file URL on loopback', /https/i],
    ];

    for (const [baseUrl, why, reason] of mustReject) {
      it(`rejects ${why}`, () => {
        expectRejects(baseUrl, reason);
      });
    }

    const mustAccept: [string, string][] = [
      ['HTTPS://API.POSTSIDER.COM', 'an uppercase scheme and host'],
      ['http://LOCALHOST:3000', 'an uppercase loopback host'],
      ['http://localhost', 'loopback without a port'],
      ['  https://api.postsider.com  ', 'surrounding whitespace'],
    ];

    for (const [baseUrl, why] of mustAccept) {
      it(`accepts ${why}`, () => {
        expect(() => new PostsiderClient(apiKey, baseUrl)).not.toThrow();
      });
    }
  });

  describe('URL construction', () => {
    it('prefixes baseUrl with /public/v1 and appends the path', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await client.get('/integrations');

      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.toString()).toBe(
        'https://api.postsider.com/public/v1/integrations'
      );
    });

    it('strips trailing slashes from the base URL', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
      const client = new PostsiderClient(apiKey, 'https://self.host:8080///');
      await client.get('/posts');

      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.toString()).toBe('https://self.host:8080/public/v1/posts');
    });

    it('appends defined query params and skips undefined/null/empty', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '[]' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await client.get('/posts', {
        startDate: '2026-06-01T00:00:00Z',
        endDate: '2026-06-30T23:59:59Z',
        customer: undefined,
        empty: '',
        nullish: null,
      });

      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.searchParams.get('startDate')).toBe('2026-06-01T00:00:00Z');
      expect(url.searchParams.get('endDate')).toBe('2026-06-30T23:59:59Z');
      expect(url.searchParams.has('customer')).toBe(false);
      expect(url.searchParams.has('empty')).toBe(false);
      expect(url.searchParams.has('nullish')).toBe(false);
    });

    it('stringifies non-string query values', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await client.get('/analytics/post/p1', { date: 7 });

      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.searchParams.get('date')).toBe('7');
    });
  });

  describe('headers', () => {
    it('sends the raw API key in Authorization (no Bearer prefix)', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await client.get('/integrations');

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(
        apiKey
      );
      expect(
        (init.headers as Record<string, string>)['Content-Type']
      ).toBeUndefined();
    });

    it('adds Content-Type and JSON body for write requests', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{"id":"p1"}' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      const body = { type: 'now', foo: 'bar' };
      await client.post('/posts', body);

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json'
      );
      expect(init.body).toBe(JSON.stringify(body));
    });

    it('adds Idempotency-Key when supplied', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{"id":"p1"}' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await client.post('/posts', { type: 'schedule' }, 'agency-job-42');

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('agency-job-42');
    });

    it('uses the right method for get/post/put/del', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await client.get('/a');
      await client.post('/b', { x: 1 });
      await client.put('/c', { y: 2 });
      await client.del('/d');

      const methods = fetchMock.mock.calls.map(
        (c) => (c[1] as RequestInit).method
      );
      expect(methods).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
    });
  });

  describe('response parsing', () => {
    it('JSON-parses a 2xx body', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ text: '{"channels":[{"id":"1"}]}' })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      const data = await client.get('/integrations');
      expect(data).toEqual({ channels: [{ id: '1' }] });
    });

    it('returns null for an empty 2xx body', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      const data = await client.del('/posts/p1');
      expect(data).toBeNull();
    });

    it('returns raw text when the body is not JSON', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: 'pong' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      const data = await client.get('/ping');
      expect(data).toBe('pong');
    });
  });

  describe('error handling', () => {
    it('throws an actionable error on 400 including the API msg', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: '{"msg":"date is required"}',
        })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await expect(client.post('/posts', {})).rejects.toThrow(
        'PostSider API POST /posts failed (400): date is required'
      );
    });

    it('falls back to raw text body when there is no msg field', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: 'boom',
        })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await expect(client.get('/posts')).rejects.toThrow(
        'PostSider API GET /posts failed (500): boom'
      );
    });

    it('gives the invalid-API-key message on 401', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: '{"msg":"nope"}',
        })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await expect(client.get('/integrations')).rejects.toThrow(
        'Unauthorized (401). The POSTSIDER_API_KEY is missing or invalid. Generate one in PostSider under Settings -> API.'
      );
    });

    it('gives the invalid-API-key message on 403', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          text: '',
        })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await expect(client.get('/integrations')).rejects.toThrow(
        'Unauthorized (403). The POSTSIDER_API_KEY is missing or invalid. Generate one in PostSider under Settings -> API.'
      );
    });

    it('explains the emergency publishing pause on 423, including the reason', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: false,
          status: 423,
          statusText: 'Locked',
          text: '{"msg":"locked","reason":"incident 41"}',
        })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');

      await expect(client.post('/posts', {})).rejects.toThrow(
        'Publishing is paused for this organization (incident 41). No posts can be scheduled or published until an owner resumes from the PostSider dashboard.'
      );
    });

    it('explains a 423 without a reason and never echoes the API key', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ ok: false, status: 423, statusText: 'Locked', text: '{}' })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');

      const error = await client.post('/posts', {}).catch((err: unknown) => err);

      expect((error as Error).message).toContain(
        'Publishing is paused for this organization. No posts can be scheduled or published until an owner resumes from the PostSider dashboard.'
      );
      expect((error as Error).message).not.toContain(apiKey);
    });

    it('throws a connection error when fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await expect(client.get('/integrations')).rejects.toThrow(
        /Could not reach PostSider at https:\/\/api\.postsider\.com\. Check POSTSIDER_API_URL and that the instance is online\. \(ECONNREFUSED\)/
      );
    });
  });

  describe('bounded requests', () => {
    // The 30 second budget itself is locked by the timeout-message test below.
    // This one only proves a fresh, not-yet-aborted signal is attached per call.
    it('attaches a fresh, not-yet-aborted abort signal to each request', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await client.get('/integrations');

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect((init.signal as AbortSignal).aborted).toBe(false);
    });

    it('passes a distinct abort signal per request', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await client.get('/a');
      await client.get('/b');

      const first = (fetchMock.mock.calls[0][1] as RequestInit).signal;
      const second = (fetchMock.mock.calls[1][1] as RequestInit).signal;
      expect(first).not.toBe(second);
    });

    it('reports a timeout distinctly from a connection failure', async () => {
      fetchMock.mockRejectedValue(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');

      await expect(client.get('/integrations')).rejects.toThrow(
        /PostSider did not respond within 30s \(GET \/integrations at https:\/\/api\.postsider\.com\)/
      );
    });

    it('caps a huge error body instead of echoing it whole', async () => {
      fetchMock.mockResolvedValue(
        mockStreamResponse({
          status: 500,
          chunks: ['x'.repeat(200 * 1024)],
        })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');

      let message = '';
      try {
        await client.get('/posts');
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }

      expect(message).toContain('failed (500)');
      expect(message).toContain('[truncated]');
      expect(message.length).toBeLessThan(9 * 1024);
    });

    it('does not mark a body of exactly the ceiling as truncated', async () => {
      // The ceiling is 8 KiB: a body of exactly that size is complete, not cut.
      const exact = 'z'.repeat(8 * 1024);
      fetchMock.mockResolvedValue(
        mockStreamResponse({ status: 500, chunks: [exact] })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');

      let message = '';
      try {
        await client.get('/posts');
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }

      expect(message).toContain('failed (500)');
      expect(message).not.toContain('[truncated]');
    });

    it('bounds an oversized error body even without a stream reader', async () => {
      // The reader-less fallback is the branch a test double hits. It must apply
      // the ceiling in BYTES: 4096 three-byte characters is 12 KiB, which is over
      // the 8 KiB ceiling even though the string length alone is under it.
      const huge = '\u20ac'.repeat(4096);
      fetchMock.mockResolvedValue(
        mockResponse({ ok: false, status: 500, text: huge })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');

      let message = '';
      try {
        await client.get('/posts');
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }

      expect(message).toContain('[truncated]');
      expect(message.length).toBeLessThan(9 * 1024);
    });

    it('refuses a path that does not start with a slash', async () => {
      fetchMock.mockResolvedValue(mockResponse({ text: '{}' }));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');

      // Every path in server.ts is a literal starting with "/", so this is an
      // internal invariant: without the guard it would silently build a bad URL.
      await expect(client.get('posts')).rejects.toThrow(
        /Internal error: API paths must start with "\/"/
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a timeout that happens while the body is still streaming', async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"chunk":'));
        },
        pull() {
          // Mid-stream failure, as a real request abort produces.
          throw new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError'
          );
        },
      });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        body,
        text: async () => '',
      } as unknown as Response);
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');

      // The full message with its origin is asserted by the fetch-rejection
      // timeout test; here the point is that a mid-stream abort is classified.
      await expect(client.get('/posts')).rejects.toThrow(
        /did not finish sending its response within 30s/
      );
    });

    it('refuses an oversized successful response instead of loading it all', async () => {
      // A 2xx body is agent-visible payload, so it is capped too. The API caps it
      // at 8 MB; exceed that and the call must fail loudly, not exhaust memory.
      const megabyte = 'm'.repeat(1024 * 1024);
      fetchMock.mockResolvedValue(
        mockStreamResponse({
          status: 200,
          chunks: Array.from({ length: 9 }, () => megabyte),
        })
      );
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');

      await expect(client.get('/posts')).rejects.toThrow(
        /returned more than 8 MB, which is more than this server will load/
      );
    });

    it('stops reading a huge error body instead of buffering it all', async () => {
      let chunksPulled = 0;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunksPulled += 1;
          // Dangerously large on purpose: an endless error body must not be read.
          controller.enqueue(encoder.encode('y'.repeat(4 * 1024)));
        },
      });
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        body,
        text: async () => '',
      } as unknown as Response);

      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await expect(client.get('/posts')).rejects.toThrow(/failed \(502\)/);

      expect(chunksPulled).toBeLessThan(64);
    });
  });

  /**
   * The API key is sent as the raw Authorization header, so a redirect must never
   * carry it anywhere. The client therefore refuses redirects outright instead of
   * relying on the runtime to strip the header: the HTTPS/loopback policy governs
   * the configured URL only, and a redirect would move the request off it. This
   * runs against real HTTP servers because the guarantee depends on the runtime's
   * fetch, not on a mock.
   */
  describe('credentials across redirects', () => {
    it('refuses a redirect instead of following it to another origin', async () => {
      const seenAuthorizations: (string | undefined)[] = [];
      const target = http.createServer((req, res) => {
        seenAuthorizations.push(req.headers.authorization);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
      const targetPort = await listen(target);

      const redirector = http.createServer((req, res) => {
        res.writeHead(302, {
          Location: `http://127.0.0.1:${targetPort}${req.url}`,
        });
        res.end();
      });
      const redirectorPort = await listen(redirector);

      const patchedGlobal = globalThis as unknown as { fetch: unknown };
      const previousFetch = patchedGlobal.fetch;
      patchedGlobal.fetch = REAL_FETCH;
      let error: Error | undefined;
      try {
        // A different port is a different origin, which is what matters here.
        const client = new PostsiderClient(
          apiKey,
          `http://127.0.0.1:${redirectorPort}`
        );
        error = await client
          .get('/integrations')
          .then(() => undefined)
          .catch((err: unknown) => err as Error);
      } finally {
        patchedGlobal.fetch = previousFetch;
        redirector.close();
        target.close();
      }

      // The request never reached the redirect target, so the key was never sent
      // to a second origin, and the agent gets an actionable message about it.
      expect(seenAuthorizations).toEqual([]);
      expect(error?.message).toMatch(/redirect/i);
      expect(error?.message).toContain('POSTSIDER_API_URL');
      expect(error?.message).not.toContain(apiKey);
    });
  });
});
