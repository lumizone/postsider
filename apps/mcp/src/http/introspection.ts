/**
 * RFC 7662 token introspection against the PostSider authorization server.
 *
 * The remote server never trusts a bearer token by its shape: every `/mcp`
 * request presents a token that this module validates over the introspection
 * endpoint (machine to machine, shared secret, fail closed). The token is the
 * ONLY source of tenant identity — no organization or account id is ever
 * accepted from tool arguments.
 */

export interface ActiveToken {
  active: true;
  /** Stable subject the rate limiter may key on. Never logged. */
  subject: string;
  scopes: Set<string>;
  clientId?: string;
  expiresAt?: number;
}

export type IntrospectionResult = ActiveToken | { active: false };

/**
 * The introspection endpoint could not answer (unset secret, network error,
 * non-2xx, unreadable body). Callers must fail closed with 503 — never treat
 * it as "token invalid", which would present an outage as a bad credential.
 */
export class IntrospectionUnavailableError extends Error {}

export interface TokenIntrospectorOptions {
  /** Absolute URL of the authorization server's introspection endpoint. */
  endpoint: string;
  /** Shared secret issued to this resource server. Unset means fail closed. */
  secret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export class TokenIntrospector {
  private readonly endpoint: string;
  private readonly secret?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: TokenIntrospectorOptions) {
    this.endpoint = options.endpoint;
    this.secret = options.secret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * A refresh token also introspects as active, but it is not an access
   * credential: `/mcp` accepts only `token_type: "Bearer"`.
   */
  async introspect(token: string): Promise<IntrospectionResult> {
    if (!this.secret) {
      throw new IntrospectionUnavailableError(
        'Token introspection is not configured on this server.'
      );
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new IntrospectionUnavailableError(
        `The introspection endpoint could not be reached (${
          err instanceof Error ? err.message : String(err)
        }).`
      );
    }

    if (!res.ok) {
      throw new IntrospectionUnavailableError(
        `The introspection endpoint answered ${res.status}.`
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new IntrospectionUnavailableError(
        'The introspection endpoint returned a body that is not JSON.'
      );
    }

    if (typeof body !== 'object' || body === null) return { active: false };
    const record = body as Record<string, unknown>;
    if (record.active !== true) return { active: false };
    if (record.token_type !== 'Bearer') return { active: false };

    const subject = typeof record.sub === 'string' ? record.sub : '';
    if (!subject) return { active: false };

    const scopes = new Set(
      (typeof record.scope === 'string' ? record.scope : '')
        .split(/\s+/)
        .filter(Boolean)
    );

    return {
      active: true,
      subject,
      scopes,
      clientId:
        typeof record.client_id === 'string' ? record.client_id : undefined,
      expiresAt: typeof record.exp === 'number' ? record.exp : undefined,
    };
  }
}
