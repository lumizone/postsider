#!/usr/bin/env node
/**
 * PostSider remote MCP server entrypoint (Streamable HTTP).
 *
 * Unlike the stdio entrypoint (`index.ts`), this process runs as a
 * PostSider-operated service behind the reverse proxy on `mcp.postsider.com`
 * and authenticates callers with OAuth 2.1 access tokens — there is no API key
 * here. Tool registrations are shared with stdio through
 * `createPostSiderMcpServer`, so no transport can drift from another.
 *
 * Configuration (environment variables):
 *   MCP_PORT                     (optional) default 8080
 *   MCP_BIND_HOST                (optional) default 0.0.0.0 (container-internal)
 *   MCP_PUBLIC_URL               (optional) default https://mcp.postsider.com
 *   MCP_AUTHORIZATION_SERVER_URL (optional) default https://api.postsider.com
 *   MCP_SCOPES                   (optional) default posts:read,posts:write
 *   MCP_OPENAI_APPS_CHALLENGE    (optional) token served at
 *                                /.well-known/openai-apps-challenge for the
 *                                OpenAI domain-verification flow
 *
 * Served today: OAuth discovery metadata (`/.well-known/oauth-protected-resource`),
 * the OpenAI challenge token, and `/healthz`. The Streamable HTTP transport at
 * `/mcp` answers 401 with the discovery challenge until OAuth token validation
 * is wired in.
 */
import { loadHttpConfig } from './http/config.js';
import { createHttpServer } from './http/server.js';

function main(): void {
  const config = loadHttpConfig();
  const server = createHttpServer(config);

  server.listen(config.port, config.bindHost, () => {
    process.stdout.write(
      `PostSider remote MCP listening on ${config.bindHost}:${config.port} ` +
        `(resource ${config.publicUrl}, authorization server ${config.authorizationServerUrl}, ` +
        `OpenAI challenge token ${config.openaiAppsChallengeToken ? 'configured' : 'not configured'})\n`
    );
  });
}

try {
  main();
} catch (err) {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
}
