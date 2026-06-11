import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Assigns a unique request ID to every request and exposes it in the response
 * headers. Makes debugging and log correlation much easier.
 *
 * OSS has no request tracing at all — this is a PostSider-exclusive feature.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const id =
      (req.headers['x-request-id'] as string) || randomUUID();
    // @ts-ignore
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
