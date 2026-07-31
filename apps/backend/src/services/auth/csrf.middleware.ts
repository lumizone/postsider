import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { HttpForbiddenException } from '@postsider/nestjs-libraries/services/exception.filter';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF protection for cookie-authenticated, state-changing requests
 * (Requirement 21.4).
 *
 * Strategy: Origin/Referer allowlist check. Browsers always attach an `Origin`
 * header on cross-site state-changing requests and scripts cannot forge it, so
 * rejecting requests whose Origin is not in our allowlist blocks classic CSRF.
 *
 * The check is intentionally skipped when:
 *  - the request carries an explicit `auth` HEADER, an `agt_`/`pos_`/`ps_`
 *    bearer token, or an API key — these are not sent automatically by browsers
 *    and therefore are not CSRF-able (programmatic clients, agents, MCP);
 *  - the method is safe (GET/HEAD/OPTIONS);
 *  - the deployment runs with NOT_SECURED (header-token dev mode), where
 *    cookies are not the auth vector.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private allowedOrigins(): string[] {
    // Normalize to bare scheme://host[:port]: the Origin header never carries a
    // trailing slash/path, but FRONTEND_URL/MAIN_URL commonly do — a raw string
    // compare would 403 every cookie-authenticated mutation.
    return [
      process.env.FRONTEND_URL,
      ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
    ]
      .filter(Boolean)
      .map((u) => safeOrigin(u as string))
      .filter(Boolean) as string[];
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Safe methods never change state.
    if (!STATE_CHANGING.has(req.method.toUpperCase())) {
      return next();
    }

    // Dev/header-token mode: cookies are not the auth vector. Compare against
    // the literal 'true' — env vars are strings, so NOT_SECURED=false must NOT
    // silently disable CSRF in a production-like deployment.
    if (process.env.NOT_SECURED === 'true') {
      return next();
    }

    // Non-browser/programmatic auth (header token or bearer) is not CSRF-able.
    const headerAuth = req.headers.auth || req.headers.authorization;
    if (headerAuth) {
      return next();
    }

    // Cookie-authenticated browser request: enforce Origin/Referer allowlist.
    const origin =
      (req.headers.origin as string) ||
      (req.headers.referer
        ? safeOrigin(req.headers.referer as string)
        : undefined);

    // No cookie auth present → nothing to protect (auth middleware will reject).
    if (!req.cookies?.auth) {
      return next();
    }

    if (!origin || !this.allowedOrigins().includes(origin)) {
      throw new HttpForbiddenException();
    }

    next();
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
