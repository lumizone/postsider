import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PostsiderClient } from '../client.js';
import { createPostSiderMcpServer } from '../server.js';
import { EXPECTED_TOOL_COUNT, EXPECTED_TOOL_NAMES, EXPECTED_TOOL_ANNOTATIONS } from './tool-inventory.js';

/**
 * The server factory must be constructible from an injected client alone, with
 * no environment variable and no process exit, so both the stdio entrypoint and
 * any future transport can share exactly one set of tool registrations.
 *
 * Importing this module is itself part of the assertion: if `server.ts` read
 * POSTSIDER_API_KEY and exited at import time, this suite would die instead of
 * reporting a failure.
 */
const apiKey = 'test-api-key-123';
const baseUrl = 'https://api.postsider.com';

describe('createPostSiderMcpServer', () => {
  let savedApiKey: string | undefined;
  let fetchMock: ReturnType<typeof jest.fn>;

  beforeEach(() => {
    savedApiKey = process.env.POSTSIDER_API_KEY;
    delete process.env.POSTSIDER_API_KEY;
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    if (savedApiKey !== undefined) {
      process.env.POSTSIDER_API_KEY = savedApiKey;
    }
    jest.resetAllMocks();
  });

  /** Connect a freshly built server to an in-memory MCP client. */
  async function connect(
    options?: Parameters<typeof createPostSiderMcpServer>[1]
  ): Promise<Client> {
    const server = createPostSiderMcpServer(
      new PostsiderClient(apiKey, baseUrl),
      options
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });

    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    return mcpClient;
  }

  /**
   * A rejected argument must be reported as a tool error naming the offending
   * field, and must never reach the network: the whole point of the schema is
   * that a malformed id or date fails in the client process.
   */
  async function expectRefusedLocally(
    mcpClient: Client,
    toolName: string,
    args: Record<string, unknown>,
    field: string
  ): Promise<void> {
    const result = await mcpClient.callTool({ name: toolName, arguments: args });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text?: string }[])
      .map((part) => part.text ?? '')
      .join('\n');
    expect(text).toMatch(/validation error/i);
    expect(text).toContain(field);
    expect(fetchMock).not.toHaveBeenCalled();
  }

  it('builds a server without an API key in the environment', () => {
    const server = createPostSiderMcpServer(new PostsiderClient(apiKey, baseUrl));

    expect(process.env.POSTSIDER_API_KEY).toBeUndefined();
    expect(server).toBeInstanceOf(McpServer);
  });

  it('registers exactly the expected tool inventory', async () => {
    const mcpClient = await connect();

    const { tools } = await mcpClient.listTools();

    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...EXPECTED_TOOL_NAMES].sort()
    );

    await mcpClient.close();
  });

  it('gives every tool a title and the expected risk annotations', async () => {
    const mcpClient = await connect();

    const { tools } = await mcpClient.listTools();

    for (const tool of tools) {
      expect(tool.title).toBeTruthy();

      const expected = EXPECTED_TOOL_ANNOTATIONS[tool.name];
      expect(expected).toBeDefined();
      // All four hints must be declared, never left to an implicit default.
      expect(tool.annotations).toEqual(expected);
    }
    expect(tools).toHaveLength(Object.keys(EXPECTED_TOOL_ANNOTATIONS).length);

    await mcpClient.close();
  });

  it('documents required provider settings on the create-post tool', async () => {
    const mcpClient = await connect();
    const { tools } = await mcpClient.listTools();
    const createPost = tools.find((tool) => tool.name === 'postsider_create_post');
    const postsSchema = (createPost?.inputSchema as {
      properties?: {
        posts?: {
          items?: {
            properties?: { settings?: { description?: string } };
          };
        };
      };
    }).properties?.posts;
    const description = postsSchema?.items?.properties?.settings?.description ?? '';

    expect(description).toContain('X: who_can_reply_post');
    expect(description).toContain('Instagram: post_type');
    expect(description).toContain('YouTube: title and type');
    expect(description).toContain('TikTok: privacy_level');
    expect(description).toContain('PUBLIC_TO_EVERYONE');
    expect(description).toContain('autoAddMusic (yes or no)');
    expect(description).toContain('content_posting_method (DIRECT_POST or UPLOAD)');
    expect(description).toContain('brand_content_toggle');
    expect(description).not.toContain('usually omit');

    await mcpClient.close();
  });

  /**
   * Input schemas must reject malformed arguments locally. The API's own
   * contracts are the reference: ids are non-empty strings, dates are ISO 8601
   * (`@IsDateString()`), `PUT /posts/:id/status` accepts only draft|schedule,
   * and an imported media URL must be public HTTPS.
   */
  describe('input schemas', () => {
    const toolsWithNonEmptyId = [
      { name: 'postsider_get_post', argument: 'postId' },
      { name: 'postsider_delete_post', argument: 'postId' },
      { name: 'postsider_request_approval', argument: 'postId' },
      { name: 'postsider_get_approval_status', argument: 'postId' },
      { name: 'postsider_get_post_missing_fields', argument: 'postId' },
      { name: 'postsider_get_post_analytics', argument: 'postId' },
      { name: 'postsider_get_channel_analytics', argument: 'channelId' },
      { name: 'postsider_find_slot', argument: 'channelId' },
      { name: 'postsider_get_customer_report', argument: 'customerId' },
    ];

    for (const { name, argument } of toolsWithNonEmptyId) {
      it(`${name} refuses an empty ${argument}`, async () => {
        const mcpClient = await connect();

        await expectRefusedLocally(mcpClient, name, { [argument]: '' }, argument);

        await mcpClient.close();
      });
    }

    it('refuses a status outside draft|schedule', async () => {
      const mcpClient = await connect();

      await expectRefusedLocally(
        mcpClient,
        'postsider_update_post_status',
        { postId: 'p1', status: 'published' },
        'status'
      );

      await mcpClient.close();
    });

    it('accepts the draft and schedule statuses', async () => {
      // A fresh Response per call: a body can only be read once.
      fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
      const mcpClient = await connect();

      for (const status of ['draft', 'schedule']) {
        const result = await mcpClient.callTool({
          name: 'postsider_update_post_status',
          arguments: { postId: 'p1', status },
        });
        expect(result.isError).toBeFalsy();
      }

      expect(fetchMock).toHaveBeenCalledTimes(2);
      await mcpClient.close();
    });

    it('refuses a plain HTTP media URL', async () => {
      const mcpClient = await connect();

      await expectRefusedLocally(
        mcpClient,
        'postsider_upload_media_from_url',
        { url: 'http://cdn.example.com/photo.png' },
        'url'
      );

      await mcpClient.close();
    });

    it('refuses a non-ISO start date', async () => {
      const mcpClient = await connect();

      await expectRefusedLocally(
        mcpClient,
        'postsider_list_posts',
        { startDate: 'tomorrow', endDate: '2026-06-30' },
        'startDate'
      );

      await mcpClient.close();
    });

    it('accepts the date forms the API accepts', async () => {
      // A fresh Response per call: a body can only be read once.
      fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
      const mcpClient = await connect();

      // `@IsDateString()` accepts a bare calendar date and a full UTC instant.
      for (const startDate of ['2026-06-01', '2026-06-01T00:00:00Z']) {
        const result = await mcpClient.callTool({
          name: 'postsider_list_posts',
          arguments: { startDate, endDate: '2026-06-30T23:59:59Z' },
        });
        expect(result.isError).toBeFalsy();
      }

      expect(fetchMock).toHaveBeenCalledTimes(2);
      await mcpClient.close();
    });

    it('refuses a date that has the right shape but does not exist', async () => {
      const mcpClient = await connect();

      for (const startDate of ['2026-13-45', '2026-02-30', '2026-04-31']) {
        await expectRefusedLocally(
          mcpClient,
          'postsider_list_posts',
          { startDate, endDate: '2026-06-30' },
          'startDate'
        );
      }
      // 2026 is not a leap year, 2028 is: the day check must follow the calendar
      // rather than a fixed table of month lengths.
      await expectRefusedLocally(
        mcpClient,
        'postsider_list_posts',
        { startDate: '2026-02-29', endDate: '2026-06-30' },
        'startDate'
      );

      await mcpClient.close();
    });

    it('accepts a leap day that exists', async () => {
      fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
      const mcpClient = await connect();

      const result = await mcpClient.callTool({
        name: 'postsider_list_posts',
        arguments: { startDate: '2028-02-29', endDate: '2028-03-01' },
      });

      expect(result.isError).toBeFalsy();
      await mcpClient.close();
    });

    it('returns a compact body, not an indented one', async () => {
      fetchMock.mockImplementation(
        async () =>
          new Response(JSON.stringify({ id: 'p1', state: 'draft' }), {
            status: 200,
          })
      );
      const mcpClient = await connect();

      const result = await mcpClient.callTool({
        name: 'postsider_get_post',
        arguments: { postId: 'p1' },
      });

      // Every result is injected into the agent's context, so the payload must
      // not be padded with indentation it cannot use.
      const text = (result.content as { type: string; text?: string }[])
        .map((part) => part.text ?? '')
        .join('');
      expect(text).toBe('{"id":"p1","state":"draft"}');

      await mcpClient.close();
    });

    it('describes delete as removing the whole multi-channel group', async () => {
      const mcpClient = await connect();

      const { tools } = await mcpClient.listTools();
      const deleteTool = tools.find((tool) => tool.name === 'postsider_delete_post');

      // One id deletes every channel version in the group (the API deletes by
      // group), so the description has to say so or an agent will under-report it.
      expect(deleteTool?.description).toMatch(/group/i);
      expect(deleteTool?.description).toMatch(/channel version/i);

      await mcpClient.close();
    });

    it('refuses a non-ISO publish date', async () => {
      const mcpClient = await connect();

      await expectRefusedLocally(
        mcpClient,
        'postsider_create_post',
        {
          type: 'draft',
          date: 'next friday',
          posts: [{ channelId: 'c1', content: 'hello' }],
        },
        'date'
      );

      await mcpClient.close();
    });

    it('refuses an empty channel id inside posts', async () => {
      const mcpClient = await connect();

      await expectRefusedLocally(
        mcpClient,
        'postsider_create_post',
        {
          type: 'draft',
          date: '2026-07-01T10:00:00Z',
          posts: [{ channelId: '', content: 'hello' }],
        },
        'channelId'
      );

      await mcpClient.close();
    });

    it('lets a valid read call reach the network', async () => {
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const mcpClient = await connect();

      const result = await mcpClient.callTool({
        name: 'postsider_get_post',
        arguments: { postId: 'p1' },
      });

      expect(result.isError).toBeFalsy();
      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.toString()).toBe(`${baseUrl}/public/v1/posts/p1`);

      await mcpClient.close();
    });
  });

  describe('media and edit tools', () => {
    const lastCall = () => {
      const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
        URL,
        RequestInit
      ];
      return { url: String(url), init };
    };

    it('does not expose the local-file tool on the shared server', async () => {
      const mcpClient = await connect();
      const { tools } = await mcpClient.listTools();
      expect(tools.map((t) => t.name)).not.toContain(
        'postsider_upload_media_from_file'
      );
      await mcpClient.close();
    });

    it('exposes the local-file tool when the stdio server opts in', async () => {
      const mcpClient = await connect({ allowLocalFiles: true });
      const { tools } = await mcpClient.listTools();
      expect(tools.map((t) => t.name)).toContain('postsider_upload_media_from_file');
      await mcpClient.close();
    });

    it('uploads a local file as multipart to /upload', async () => {
      const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const dir = await mkdtemp(join(tmpdir(), 'ps-mcp-'));
      const file = join(dir, 'pic.png');
      await writeFile(file, Buffer.from([1, 2, 3, 4]));
      fetchMock.mockImplementation(
        async () => new Response('{"id":"m1","path":"x.png"}', { status: 200 })
      );

      const mcpClient = await connect({ allowLocalFiles: true });
      const result = await mcpClient.callTool({
        name: 'postsider_upload_media_from_file',
        arguments: { path: file },
      });

      expect(result.isError).toBeFalsy();
      const { url, init } = lastCall();
      expect(url).toMatch(/\/public\/v1\/upload$/);
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect(((init.body as FormData).get('file') as File).name).toBe('pic.png');
      // No JSON content type: fetch must set the multipart boundary itself.
      expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
      await mcpClient.close();
      await rm(dir, { recursive: true, force: true });
    });

    it('reports a missing local file without calling the API', async () => {
      const mcpClient = await connect({ allowLocalFiles: true });
      const result = await mcpClient.callTool({
        name: 'postsider_upload_media_from_file',
        arguments: { path: '/definitely/not/here.png' },
      });
      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      await mcpClient.close();
    });

    const text = (r: any) => (r.content as { text?: string }[])[0].text ?? '';

    it('states the base64 limit of the connection it runs on, and enforces it', async () => {
      const remote = await connect({ maxBase64Bytes: 2.5 * 1024 * 1024 });
      const { tools } = await remote.listTools();
      const tool = tools.find((t) => t.name === 'postsider_upload_media_base64')!;
      expect(tool.description).toContain('2.5 MB');
      expect(tool.description).not.toContain('25 MB');

      const tooBig = await remote.callTool({
        name: 'postsider_upload_media_base64',
        arguments: { data: 'A'.repeat(5 * 1024 * 1024) },
      });
      expect(tooBig.isError).toBe(true);
      expect(text(tooBig)).toContain('2.5 MB');
      expect(fetchMock).not.toHaveBeenCalled();
      await remote.close();

      // The local server keeps the API's own 25 MB ceiling.
      const local = await connect();
      const t2 = (await local.listTools()).tools.find((t) => t.name === 'postsider_upload_media_base64')!;
      expect(t2.description).toContain('25 MB');
      await local.close();
    });

    it('never reads a non-media file from disk', async () => {
      const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const dir = await mkdtemp(join(tmpdir(), 'ps-mcp-'));
      const secret = join(dir, 'id_rsa');
      await writeFile(secret, 'PRIVATE KEY');
      const mcpClient = await connect({ allowLocalFiles: true });
      for (const path of [secret, join(dir, 'notes.txt'), join(dir, 'x.png.exe')]) {
        const result = await mcpClient.callTool({
          name: 'postsider_upload_media_from_file',
          arguments: { path },
        });
        expect(result.isError).toBe(true);
      }
      expect(fetchMock).not.toHaveBeenCalled();
      await mcpClient.close();
      await rm(dir, { recursive: true, force: true });
    });

    it('does not follow a symlink named like an image to a non-media file', async () => {
      const { mkdtemp, writeFile, symlink, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const dir = await mkdtemp(join(tmpdir(), 'ps-mcp-'));
      const target = join(dir, 'secrets.env');
      await writeFile(target, 'TOKEN=1');
      const link = join(dir, 'photo.png');
      await symlink(target, link);
      const mcpClient = await connect({ allowLocalFiles: true });
      const result = await mcpClient.callTool({
        name: 'postsider_upload_media_from_file',
        arguments: { path: link },
      });
      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      await mcpClient.close();
      await rm(dir, { recursive: true, force: true });
    });

    it('sends base64 media to /upload-base64', async () => {
      fetchMock.mockImplementation(async () => new Response('{"id":"m1"}', { status: 200 }));
      const mcpClient = await connect();
      const result = await mcpClient.callTool({
        name: 'postsider_upload_media_base64',
        arguments: { data: 'AAAA', filename: 'a.png' },
      });
      expect(result.isError).toBeFalsy();
      const { url, init } = lastCall();
      expect(url).toMatch(/\/public\/v1\/upload-base64$/);
      expect(JSON.parse(init.body as string)).toEqual({ data: 'AAAA', filename: 'a.png' });
      await mcpClient.close();
    });

    it('refuses an oversized base64 payload locally', async () => {
      const mcpClient = await connect();
      const result = await mcpClient.callTool({
        name: 'postsider_upload_media_base64',
        arguments: { data: 'A'.repeat(35 * 1024 * 1024) },
      });
      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      await mcpClient.close();
    });

    it('lists the media library with paging and search', async () => {
      fetchMock.mockImplementation(async () => new Response('{"results":[]}', { status: 200 }));
      const mcpClient = await connect();
      await mcpClient.callTool({
        name: 'postsider_list_media',
        arguments: { page: 2, search: 'logo' },
      });
      const { url } = lastCall();
      expect(url).toContain('/public/v1/media?');
      expect(url).toContain('page=2');
      expect(url).toContain('search=logo');
      await mcpClient.close();
    });

    it('edits a post with PUT and only the fields given', async () => {
      fetchMock.mockImplementation(async () => new Response('[{"postId":"p1"}]', { status: 200 }));
      const mcpClient = await connect();
      const images = [{ id: 'm1', path: 'https://x/a.png' }];
      const result = await mcpClient.callTool({
        name: 'postsider_update_post',
        arguments: { postId: 'p1', images, firstComment: '' },
      });
      expect(result.isError).toBeFalsy();
      const { url, init } = lastCall();
      expect(url).toMatch(/\/public\/v1\/posts\/p1$/);
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body as string)).toEqual({ images, firstComment: null });
      await mcpClient.close();
    });

    it('refuses an edit that changes nothing', async () => {
      const mcpClient = await connect();
      const result = await mcpClient.callTool({
        name: 'postsider_update_post',
        arguments: { postId: 'p1' },
      });
      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      await mcpClient.close();
    });
  });

  describe('review follow-ups', () => {
    const lastUrl = () =>
      String((fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [URL])[0]);
    const lastBody = () =>
      JSON.parse(
        (fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [URL, RequestInit])[1]
          .body as string
      );
    const text = (r: any) => (r.content as { text?: string }[])[0].text ?? '';

    it('reads the channel rules for one channel', async () => {
      fetchMock.mockImplementation(async () => new Response('{"output":{"maxLength":280}}', { status: 200 }));
      const mcpClient = await connect();
      const result = await mcpClient.callTool({
        name: 'postsider_get_channel_rules',
        arguments: { channelId: 'c1' },
      });
      expect(result.isError).toBeFalsy();
      expect(lastUrl()).toMatch(/\/public\/v1\/integration-settings\/c1$/);
      await mcpClient.close();
    });

    it('filters and pages the post list', async () => {
      fetchMock.mockImplementation(async () => new Response('{"posts":[]}', { status: 200 }));
      const mcpClient = await connect();
      await mcpClient.callTool({
        name: 'postsider_list_posts',
        arguments: {
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          state: 'ERROR',
          channelId: 'c1',
        },
      });
      const url = lastUrl();
      expect(url).toContain('state=ERROR');
      expect(url).toContain('integration=c1');
      expect(url).toContain('page=1');
      expect(url).toContain('limit=50');
      await mcpClient.close();
    });

    it('lets a draft omit the date but not a scheduled post', async () => {
      fetchMock.mockImplementation(async () => new Response('[]', { status: 200 }));
      const mcpClient = await connect();
      const posts = [{ channelId: 'c1', content: 'hi' }];

      const draft = await mcpClient.callTool({
        name: 'postsider_create_post',
        arguments: { type: 'draft', posts },
      });
      expect(draft.isError).toBeFalsy();
      expect(lastBody().date).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      fetchMock.mockClear();
      const scheduled = await mcpClient.callTool({
        name: 'postsider_create_post',
        arguments: { type: 'schedule', posts },
      });
      expect(scheduled.isError).toBe(true);
      expect(text(scheduled)).toContain('date');
      expect(fetchMock).not.toHaveBeenCalled();
      await mcpClient.close();
    });

    it('cuts an oversized result with a hint to narrow the request', async () => {
      fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ posts: 'x'.repeat(150_000) }), { status: 200 })
      );
      const mcpClient = await connect();
      const result = await mcpClient.callTool({
        name: 'postsider_list_posts',
        arguments: { startDate: '2026-06-01', endDate: '2026-06-30' },
      });
      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain('Result truncated');
      expect(text(result).length).toBeLessThan(101_000 + 400);
      await mcpClient.close();
    });
  });

  describe('workspace management tools', () => {
    const lastCall = () => {
      const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [URL, RequestInit];
      return { url: String(url), init, body: init.body ? JSON.parse(init.body as string) : undefined };
    };
    const call = async (name: string, args: Record<string, unknown>, response = '{}') => {
      fetchMock.mockImplementation(async () => new Response(response, { status: 200 }));
      const c = await connect();
      const result = await c.callTool({ name, arguments: args });
      await c.close();
      return result;
    };

    it('asks for a connect link, translating reconnectChannelId to refresh', async () => {
      await call('postsider_connect_channel', { platform: 'linkedin', reconnectChannelId: 'c9' });
      const { url, init } = lastCall();
      expect(url).toMatch(/\/public\/v1\/social\/linkedin\?refresh=c9$/);
      expect(init.method).toBe('GET');
    });

    it('rejects a platform that is not a plain identifier', async () => {
      const result = await call('postsider_connect_channel', { platform: '../x?y' });
      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('enables and disables a channel', async () => {
      await call('postsider_set_channel_enabled', { channelId: 'c1', enabled: false });
      expect(lastCall().url).toMatch(/\/integrations\/c1\/disable$/);
      await call('postsider_set_channel_enabled', { channelId: 'c1', enabled: true });
      expect(lastCall().url).toMatch(/\/integrations\/c1\/enable$/);
    });

    it('disconnects with DELETE', async () => {
      await call('postsider_disconnect_channel', { channelId: 'c1' });
      expect(lastCall().init.method).toBe('DELETE');
      expect(lastCall().url).toMatch(/\/integrations\/c1$/);
    });

    it('sets the queue plan in the DTO shape and validates the minutes', async () => {
      await call('postsider_set_queue_plan', {
        channelId: 'c1',
        slots: [{ time: 540 }, { time: 1110, days: [1, 3, 5] }],
        timezone: 'Europe/Warsaw',
      });
      expect(lastCall().init.method).toBe('PUT');
      // Weekday restrictions must survive the round trip.
      expect(lastCall().body).toEqual({
        time: [{ time: 540 }, { time: 1110, days: [1, 3, 5] }],
        timezone: 'Europe/Warsaw',
      });

      fetchMock.mockClear();
      const bad = await call('postsider_set_queue_plan', { channelId: 'c1', slots: [{ time: 1440 }] });
      expect(bad.isError).toBe(true);
      const badDay = await call('postsider_set_queue_plan', { channelId: 'c1', slots: [{ time: 60, days: [7] }] });
      expect(badDay.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reads queue plan and smart slots', async () => {
      await call('postsider_get_queue_plan', { channelId: 'c1' });
      expect(lastCall().url).toMatch(/\/integrations\/c1\/queue-plan$/);
      await call('postsider_get_smart_slots', { channelId: 'c1', count: 5 });
      expect(lastCall().url).toMatch(/\/integrations\/c1\/smart-slots\?count=5$/);
    });

    it('assigns a channel to a client', async () => {
      await call('postsider_set_channel_customer', { channelId: 'c1', customerName: 'Acme' });
      expect(lastCall().body).toEqual({ name: 'Acme' });
    });

    it('creates a library item with only the fields of its kind', async () => {
      await call('postsider_save_library_item', {
        kind: 'hashtag-groups',
        name: 'Launch',
        hashtags: ['#a'],
        content: 'ignored for this kind',
        utmSource: 'ignored',
      });
      const { url, init, body } = lastCall();
      expect(url).toMatch(/\/library\/hashtag-groups$/);
      expect(init.method).toBe('POST');
      expect(body).toEqual({ name: 'Launch', hashtags: ['#a'] });
    });

    it('updates a library item when an id is given, and deletes it', async () => {
      await call('postsider_save_library_item', {
        kind: 'caption-templates',
        id: 't1',
        name: 'Hi',
        content: 'Hello',
      });
      expect(lastCall().init.method).toBe('PUT');
      expect(lastCall().url).toMatch(/\/library\/caption-templates\/t1$/);

      await call('postsider_delete_library_item', { kind: 'utm-presets', id: 'u1' });
      expect(lastCall().init.method).toBe('DELETE');
      expect(lastCall().url).toMatch(/\/library\/utm-presets\/u1$/);
    });

    it('reads the library', async () => {
      await call('postsider_get_content_library', {});
      expect(lastCall().url).toMatch(/\/public\/v1\/library$/);
    });

    it('duplicates a post', async () => {
      await call('postsider_duplicate_post', { postId: 'p1', channelId: 'c2' });
      expect(lastCall().url).toMatch(/\/posts\/p1\/duplicate$/);
      expect(lastCall().body).toEqual({ channelId: 'c2' });
    });

    it('checks and rewrites text', async () => {
      await call('postsider_check_post', { content: 'hi', platforms: ['x'] });
      expect(lastCall().url).toMatch(/\/posts\/check$/);
      expect(lastCall().body).toMatchObject({ content: 'hi', platforms: ['x'], hasMedia: false });

      await call('postsider_rewrite_post', { content: 'hi', tone: 'punchy' });
      expect(lastCall().url).toMatch(/\/posts\/rewrite$/);
      expect(lastCall().body).toMatchObject({ tone: 'punchy', count: 3 });
    });

    it('limits platforms in a check to three', async () => {
      const r = await call('postsider_check_post', {
        content: 'hi',
        platforms: ['a', 'b', 'c', 'd'],
      });
      expect(r.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deletes media', async () => {
      await call('postsider_delete_media', { mediaId: 'm1' });
      expect(lastCall().init.method).toBe('DELETE');
      expect(lastCall().url).toMatch(/\/media\/m1$/);
    });
  });
});
