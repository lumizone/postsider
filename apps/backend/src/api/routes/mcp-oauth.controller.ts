import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { McpOAuthService } from '@postsider/nestjs-libraries/database/prisma/oauth/mcp-oauth.service';
import {
  McpIntrospectDto,
  McpRegisterDto,
  McpRevokeDto,
} from '@postsider/nestjs-libraries/dtos/oauth/mcp.dto';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';

/**
 * Public (unauthenticated) MCP OAuth endpoints: discovery metadata, dynamic
 * client registration, introspection, revocation and userinfo. Session-bound
 * endpoints (the consent flow) live on `OAuthAuthorizedController` instead.
 */
@ApiTags('OAuth')
@Controller()
export class McpOAuthController {
  constructor(private _mcpOAuthService: McpOAuthService) {}

  @Get('/.well-known/oauth-authorization-server')
  authorizationServerMetadata() {
    return this._mcpOAuthService.authorizationServerMetadata();
  }

  @Post('/oauth/register')
  async register(@Body() body: McpRegisterDto, @Req() req: Request) {
    await assertRegistrationRate(req);
    return this._mcpOAuthService.registerClient(body, clientIp(req));
  }

  @Post('/oauth/introspect')
  introspect(
    @Body() body: McpIntrospectDto,
    @Headers('authorization') auth?: string
  ) {
    assertIntrospectionAuth(auth);
    return this._mcpOAuthService.introspect(body.token);
  }

  @Post('/oauth/revoke')
  revoke(@Body() body: McpRevokeDto) {
    return this._mcpOAuthService.revokeToken(body.token);
  }

  @Get('/oauth/userinfo')
  async userinfo(
    @Headers('authorization') auth: string | undefined,
    @Res({ passthrough: true }) res: Response
  ) {
    const match = (auth || '').match(/^Bearer\s+(\S+)\s*$/i);
    if (!match) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw new HttpException(
        { error: 'invalid_token' },
        HttpStatus.UNAUTHORIZED
      );
    }
    try {
      return await this._mcpOAuthService.userinfo(match[1]);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.UNAUTHORIZED) {
        res.setHeader(
          'WWW-Authenticate',
          'Bearer error="invalid_token", error_description="The access token is invalid or expired"'
        );
      }
      throw err;
    }
  }
}

function clientIp(req: Request): string {
  const forwarded = (req.headers['x-forwarded-for'] as string) || '';
  const first = forwarded.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

/**
 * Registration is the one open, state-creating endpoint, so it gets a per-IP
 * cap. Window is one hour; the limit is env-tunable because the OpenAI review
 * connects from several addresses during a scan.
 */
async function assertRegistrationRate(req: Request) {
  const limit = parseInt(process.env.MCP_DCR_RATE_LIMIT || '30', 10);
  const key = `rate:mcp-dcr:${clientIp(req)}`;
  const current = await ioRedis.incr(key);
  if (current === 1) {
    await ioRedis.expire(key, 3600);
  }
  if (current > limit) {
    throw new HttpException(
      {
        error: 'temporarily_unavailable',
        error_description: 'Too many client registrations from this address',
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }
}

/**
 * The introspection endpoint serves the MCP resource server, not the public:
 * it requires the shared secret issued to that service. Unset secret means the
 * deployment is incomplete — fail closed with 503 rather than exposing token
 * metadata anonymously.
 */
function assertIntrospectionAuth(auth?: string) {
  const secret = process.env.MCP_INTROSPECTION_SECRET;
  if (!secret) {
    throw new HttpException(
      {
        error: 'temporarily_unavailable',
        error_description: 'Token introspection is not configured',
      },
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }
  const provided = (auth || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpException(
      { error: 'invalid_client' },
      HttpStatus.UNAUTHORIZED
    );
  }
}
