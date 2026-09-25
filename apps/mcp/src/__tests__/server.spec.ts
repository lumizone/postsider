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
  async function connect(): Promise<Client> {
    const server = createPostSiderMcpServer(
      new PostsiderClient(apiKey, baseUrl)
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
});
