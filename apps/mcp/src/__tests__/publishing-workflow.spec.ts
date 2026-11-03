import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PostsiderClient } from '../client.js';
import { scopeGuardedClient } from '../http/scope-guard.js';
import { createPostSiderMcpServer } from '../server.js';

/**
 * Real MCP SDK client/server handshake and tool invocations. The Public API is
 * replaced by an in-process stateful HTTP response double. No user credential
 * or connected social network is used, and nothing is ever published.
 */
type Call = { method: string; path: string; body?: any };

describe('draft-first MCP publishing contract', () => {
  const originalFetch = globalThis.fetch;
  let requests: Call[];
  let post: { id: string; state: string; date: string; content: string } | null;

  beforeEach(() => {
    requests = [];
    post = null;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const path = url.pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, path, body });

      let answer: unknown;
      if (method === 'GET' && path === '/public/v1/integrations') {
        answer = [{ id: 'ch_test', name: 'Isolated test channel', identifier: 'x' }];
      } else if (method === 'GET' && path === '/public/v1/publishing/state') {
        answer = { paused: false };
      } else if (method === 'POST' && path === '/public/v1/posts') {
        post = {
          id: 'post_test',
          state: body.type === 'draft' ? 'DRAFT' : 'QUEUE',
          date: body.date,
          content: body.posts[0].value[0].content,
        };
        answer = { id: post.id, state: post.state };
      } else if (method === 'GET' && path === '/public/v1/posts/post_test') {
        answer = post;
      } else if (method === 'PUT' && path === '/public/v1/posts/post_test/status') {
        if (!post) return new Response('{"msg":"Post not found"}', { status: 404 });
        post.state = body.status === 'schedule' ? 'QUEUE' : 'DRAFT';
        answer = { id: post.id, state: post.state };
      } else {
        return new Response('{"msg":"Unexpected endpoint"}', { status: 404 });
      }
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function connect(scopes?: string[]) {
    const api = new PostsiderClient('isolated-test-key', 'https://api.postsider.com');
    const guarded = scopes ? scopeGuardedClient(api, new Set(scopes)) : api;
    const server = createPostSiderMcpServer(guarded);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'stage4-workflow-test', version: '1.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text?: string }>).map((x) => x.text ?? '').join('\n');
    return { result, text, data: result.isError ? null : JSON.parse(text) as any };
  }

  it('defaults to an unpublishable draft when no type was supplied', async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.find((tool) => tool.name === 'postsider_create_post')?.description)
        .toContain('Default to "draft"');
      const created = await call(client, 'postsider_create_post', {
        posts: [{ channelId: 'ch_test', content: 'Preview only' }],
      });
      expect(created.result.isError).toBeFalsy();
      expect(created.data.state).toBe('DRAFT');
      expect(requests.find((x) => x.method === 'POST')?.body.type).toBe('draft');
      expect(requests.some((x) => x.method === 'PUT')).toBe(false);
    } finally {
      await close();
    }
  });

  it('does draft → readback → explicitly schedule → readback without publish now', async () => {
    const { client, close } = await connect(['posts:read', 'posts:write']);
    try {
      const channels = await call(client, 'postsider_list_channels', {});
      expect(channels.data[0].id).toBe('ch_test');

      const created = await call(client, 'postsider_create_post', {
        type: 'draft',
        date: '2026-12-02T12:00:00Z',
        posts: [{ channelId: channels.data[0].id, content: 'Approved mock content' }],
      });
      expect(created.result.isError).toBeFalsy();
      const id = created.data.id;
      const readback = await call(client, 'postsider_get_post', { postId: id });
      expect(readback.data).toMatchObject({
        state: 'DRAFT',
        content: 'Approved mock content',
      });

      // Represents a separate, explicitly authorized scheduling step.
      const queued = await call(client, 'postsider_update_post_status', {
        postId: id,
        status: 'schedule',
      });
      expect(queued.result.isError).toBeFalsy();
      const verified = await call(client, 'postsider_get_post', { postId: id });
      expect(verified.data.state).toBe('QUEUE');
      expect(verified.data.date).toBe('2026-12-02T12:00:00Z');

      expect(requests.map((x) => [x.method, x.path])).toEqual([
        ['GET', '/public/v1/integrations'],
        ['POST', '/public/v1/posts'],
        ['GET', '/public/v1/posts/post_test'],
        ['PUT', '/public/v1/posts/post_test/status'],
        ['GET', '/public/v1/posts/post_test'],
      ]);
      expect(requests.find((x) => x.method === 'POST')?.body.type).toBe('draft');
      expect(requests.some((x) => x.body?.type === 'now')).toBe(false);
    } finally {
      await close();
    }
  });

  it('refuses a write under read-only OAuth scopes before contacting the API', async () => {
    const { client, close } = await connect(['posts:read']);
    try {
      const read = await call(client, 'postsider_list_channels', {});
      expect(read.result.isError).toBeFalsy();
      const write = await call(client, 'postsider_create_post', {
        type: 'draft',
        posts: [{ channelId: 'ch_test', content: 'Not created' }],
      });
      expect(write.result.isError).toBe(true);
      expect(write.text).toContain('posts:write');
      expect(requests.some((x) => x.method !== 'GET')).toBe(false);
    } finally {
      await close();
    }
  });
});
