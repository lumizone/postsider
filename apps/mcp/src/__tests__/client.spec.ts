import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { PostsiderClient } from '../client.js';

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

    it('throws a connection error when fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new PostsiderClient(apiKey, 'https://api.postsider.com');
      await expect(client.get('/integrations')).rejects.toThrow(
        /Could not reach PostSider at https:\/\/api\.postsider\.com\. Check POSTSIDER_API_URL and that the instance is online\. \(ECONNREFUSED\)/
      );
    });
  });
});
