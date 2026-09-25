import type { HttpConfig } from './config.js';

/**
 * RFC 9728 protected-resource metadata. An MCP client that gets a 401 fetches
 * this document to learn which authorization server issues tokens for this
 * resource and which scopes it can ask for. The authorization server itself
 * (metadata, dynamic client registration, authorize, token, userinfo) lives in
 * the PostSider backend, not here.
 */
export function protectedResourceMetadata(config: HttpConfig) {
  return {
    resource: config.publicUrl,
    resource_name: 'PostSider',
    resource_documentation: 'https://docs.postsider.com/agent/mcp/overview',
    authorization_servers: [config.authorizationServerUrl],
    scopes_supported: config.scopesSupported,
    bearer_methods_supported: ['header'],
  };
}

/**
 * `WWW-Authenticate` value for 401 responses. The MCP spec expects the
 * `resource_metadata` parameter so the client can discover the authorization
 * server without prior configuration.
 */
export function bearerChallenge(config: HttpConfig): string {
  return `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource"`;
}
