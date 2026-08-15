import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';

/**
 * Meta platform compliance callbacks (Facebook / Instagram / Threads).
 *
 * Configured per app in the Meta developer console (App settings > Basic):
 *   Data Deletion Request URL: https://social.example.com/api/meta/data-deletion/<app>
 *   Deauthorize Callback URL:  https://social.example.com/api/meta/deauthorize/<app>
 * where <app> is one of: facebook (covers the Facebook+Instagram Business app),
 * instagram (the standalone Instagram Login app), threads.
 *
 * Meta POSTs application/x-www-form-urlencoded with a `signed_request` whose
 * payload (HMAC-SHA256, signed with the app secret) carries the app-scoped
 * user id. Deletion is handled synchronously: every connected channel that
 * belongs to that platform user is soft-deleted and its tokens are wiped, so
 * the returned status URL can already report the request as completed.
 */

interface MetaAppConfig {
  secret: () => string | undefined;
  providers: string[];
  prefixes: string[];
}

const META_APPS: Record<string, MetaAppConfig> = {
  facebook: {
    secret: () => process.env.FACEBOOK_APP_SECRET,
    providers: ['facebook', 'instagram'],
    // Facebook/Instagram-via-Business integrations keep the app-scoped user id
    // in rootInternalId as `facebook-<id>` / `instagram-<id>` (the page id
    // replaces internalId once a page is picked).
    prefixes: ['facebook-', 'instagram-'],
  },
  instagram: {
    secret: () => process.env.INSTAGRAM_APP_SECRET,
    providers: ['instagram-standalone'],
    prefixes: [''],
  },
  threads: {
    secret: () => process.env.THREADS_APP_SECRET,
    providers: ['threads'],
    prefixes: [''],
  },
};

function parseSignedRequest(
  signedRequest: string,
  secret: string
): Record<string, any> | null {
  const dot = signedRequest.indexOf('.');
  if (dot <= 0) {
    return null;
  }
  const encodedSig = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);
  let sig: Buffer;
  try {
    sig = Buffer.from(encodedSig, 'base64url');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    );
    if (String(payload?.algorithm || '').toUpperCase() !== 'HMAC-SHA256') {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

@ApiTags('Meta Compliance')
@Controller('/meta')
export class MetaComplianceController {
  constructor(private _integrationService: IntegrationService) {}

  @Post('/data-deletion/:app')
  @HttpCode(200)
  async dataDeletion(
    @Param('app') app: string,
    @Body('signed_request') signedRequest?: string
  ) {
    const { payload, config } = this.verify(app, signedRequest);
    const userId = String(payload.user_id || '');
    if (!userId) {
      throw new HttpException('Missing user_id', HttpStatus.BAD_REQUEST);
    }

    const removed =
      await this._integrationService.wipeIntegrationsForPlatformUser(
        config.providers,
        config.prefixes.map((prefix) => `${prefix}${userId}`)
      );

    const confirmationCode = this.confirmationCode(app, userId, config);
    console.log(
      JSON.stringify({
        event: 'meta-data-deletion',
        app,
        removedChannels: removed,
        confirmationCode,
      })
    );

    // DATA_DELETION_URL points at the public instructions page (cloud: the
    // postsider.com landing); without it we fall back to the built-in status
    // page so self-hosted installs stay self-contained.
    const statusBase =
      process.env.DATA_DELETION_URL ||
      `${process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL}/meta/data-deletion/status`;
    return {
      url: `${statusBase}?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    };
  }

  @Post('/deauthorize/:app')
  @HttpCode(200)
  async deauthorize(
    @Param('app') app: string,
    @Body('signed_request') signedRequest?: string
  ) {
    const { payload, config } = this.verify(app, signedRequest);
    const userId = String(payload.user_id || '');
    if (!userId) {
      throw new HttpException('Missing user_id', HttpStatus.BAD_REQUEST);
    }

    const disabled =
      await this._integrationService.deauthorizeIntegrationsForPlatformUser(
        config.providers,
        config.prefixes.map((prefix) => `${prefix}${userId}`)
      );

    console.log(
      JSON.stringify({
        event: 'meta-deauthorize',
        app,
        disabledChannels: disabled,
      })
    );

    return { success: true };
  }

  @Get('/data-deletion/status')
  @Header('Content-Type', 'text/html; charset=utf-8')
  status(@Query('code') code?: string) {
    const safeCode = String(code || '').replace(/[^a-zA-Z0-9-]/g, '');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Data deletion status | PostSider</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #000; margin: 0; display: grid; place-items: center; min-height: 100vh; }
  main { max-width: 480px; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 14px; line-height: 1.6; color: #333; margin: 0 0 12px; }
  code { background: #f2f2f2; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>Data deletion request completed</h1>
  ${
    safeCode
      ? `<p>Confirmation code: <code>${safeCode}</code></p>`
      : ''
  }
  <p>All social media channels and access tokens associated with your account have been removed from PostSider.</p>
  <p>If you have any questions, contact us at <a href="mailto:lukasz@postsider.com">lukasz@postsider.com</a>.</p>
</main>
</body>
</html>`;
  }

  private verify(app: string, signedRequest?: string) {
    const config = META_APPS[app];
    if (!config) {
      throw new HttpException('Unknown app', HttpStatus.NOT_FOUND);
    }
    const secret = config.secret();
    if (!secret) {
      throw new HttpException('App not configured', HttpStatus.NOT_FOUND);
    }
    if (!signedRequest || typeof signedRequest !== 'string') {
      throw new HttpException(
        'Missing signed_request',
        HttpStatus.BAD_REQUEST
      );
    }
    const payload = parseSignedRequest(signedRequest, secret);
    if (!payload) {
      throw new HttpException('Invalid signature', HttpStatus.FORBIDDEN);
    }
    return { payload, config };
  }

  private confirmationCode(
    app: string,
    userId: string,
    config: MetaAppConfig
  ) {
    // Deterministic per app+user so Meta's retries return the same code.
    return `psdel-${createHmac('sha256', config.secret()!)
      .update(`${app}:${userId}`)
      .digest('hex')
      .slice(0, 20)}`;
  }
}
