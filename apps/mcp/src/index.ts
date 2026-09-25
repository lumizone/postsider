#!/usr/bin/env node
/**
 * PostSider MCP server entrypoint (stdio transport).
 *
 * Reads configuration from the environment, builds the client, and connects the
 * shared server factory to stdio. Every tool registration lives in `server.ts`
 * so that no transport can drift away from another.
 *
 * Configuration (environment variables):
 *   POSTSIDER_API_KEY  (required) - org API key from Settings -> API
 *   POSTSIDER_API_URL  (optional) - instance base URL
 *                                   default: https://api.postsider.com
 *
 * Transport: stdio (the standard for local MCP clients).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostsiderClient } from './client.js';
import { createPostSiderMcpServer } from './server.js';

const apiKey = process.env.POSTSIDER_API_KEY;
const baseUrl = process.env.POSTSIDER_API_URL || 'https://api.postsider.com';

async function main(key: string, url: string) {
  const client = new PostsiderClient(key, url);
  const server = createPostSiderMcpServer(client);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log the origin only: it is what the client actually talks to, and it cannot
  // carry a query-string secret that the client would have dropped anyway.
  process.stderr.write(
    `PostSider MCP server running (stdio) against ${new URL(url).origin}\n`
  );
}

if (!apiKey) {
  // Fail fast with an actionable message on stderr (stdout is the MCP channel).
  process.stderr.write(
    'POSTSIDER_API_KEY is not set. Add it to your MCP client config. ' +
      'Generate a key in PostSider under Settings -> API.\n'
  );
  process.exit(1);
}

main(apiKey, baseUrl).catch((err) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
