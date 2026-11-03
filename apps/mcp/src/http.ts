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
 *   MCP_API_URL                  (optional) default https://api.postsider.com
 *                                base URL tool calls are forwarded to
 *   MCP_SCOPES                   (optional) default posts:read,posts:write
 *   MCP_INTROSPECTION_SECRET     (required for /mcp) shared secret for the
 *                                authorization server's token introspection;
 *                                unset means /mcp fails closed with 503
 *   MCP_RATE_LIMIT_RPM           (optional) per-token requests/minute, default 240
 *   MCP_OPENAI_APPS_CHALLENGE    (optional) token served at
 *                                /.well-known/openai-apps-challenge for the
 *                                OpenAI domain-verification flow
 *
 * Served: OAuth discovery metadata (`/.well-known/oauth-protected-resource`),
 * the OpenAI challenge token, `/healthz`, and the Streamable HTTP transport at
 * `/mcp` (stateless; every request carries its own OAuth access token, which is
 * validated by introspection and forwarded to the PostSider API unchanged).
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
        `API ${config.apiBaseUrl}, introspection ` +
        `${config.introspectionSecret ? 'configured' : 'NOT configured - /mcp answers 503'}, ` +
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
