import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

// Only well-formed client-supplied ids are echoed back (prevents log forging
// and unbounded header sizes).
const REQUEST_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Assigns a unique request ID to every request and exposes it in the response
 * headers. Makes debugging and log correlation much easier.
 *
 * OSS has no request tracing at all — this is a PostSider-exclusive feature.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && REQUEST_ID_RE.test(incoming)
        ? incoming
        : randomUUID();
    // @ts-ignore
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
