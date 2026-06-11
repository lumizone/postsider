import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const { method } = context.switchToHttp().getRequest<Request>();
    // Apply rate limiting to all mutating requests (POST, PUT, DELETE, PATCH).
    // GET requests are excluded to avoid throttling normal page loads/polling.
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return super.canActivate(context);
    }
    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    return (
      req.org?.id + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
    );
  }
}
