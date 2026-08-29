import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * HTTP 423 (Locked) returned when publishing is attempted while the org is
 * paused (Emergency Pause / kill switch). The response body is a structured
 * `publishing_paused` error so the dashboard, MCP and SDK can surface WHY the
 * post did not go out instead of a generic failure.
 *
 * Deliberately a plain HttpException — NOT HttpForbiddenException: the global
 * HttpExceptionFilter only catches HttpForbiddenException and remaps it to 401
 * + clears cookies. 423 is a plan/permission-style gate on an authenticated
 * user and must never log the user out.
 */
export class PublishingPausedException extends HttpException {
  constructor(reason?: string | null) {
    super(
      {
        error: 'publishing_paused',
        state: 'paused',
        reason: reason || undefined,
      },
      HttpStatus.LOCKED // 423
    );
  }
}
