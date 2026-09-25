import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { OAuthService } from '@postsider/nestjs-libraries/database/prisma/oauth/oauth.service';
import { McpOAuthService } from '@postsider/nestjs-libraries/database/prisma/oauth/mcp-oauth.service';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { User, Organization } from '@prisma/client';
import { ApproveOAuthDto } from '@postsider/nestjs-libraries/dtos/oauth/authorize-oauth.dto';
import {
  McpAuthorizeQueryDto,
  McpConsentDto,
  McpTokenDto,
} from '@postsider/nestjs-libraries/dtos/oauth/mcp.dto';

@ApiTags('OAuth')
@Controller('/oauth')
export class OAuthController {
  constructor(
    private _oauthService: OAuthService,
    private _mcpOAuthService: McpOAuthService
  ) {}

  @Get('/authorize')
  async authorize(@Query() query: McpAuthorizeQueryDto, @Res() res: Response) {
    // Requests carrying a PKCE challenge belong to the MCP/DCR flow: record a
    // pending consent and send the browser to the consent page. The legacy
    // flow keeps returning the app-info JSON its own consent UI consumes.
    if (query.code_challenge || query.code_challenge_method) {
      const { consentUrl } = await this._mcpOAuthService.beginAuthorization({
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: query.code_challenge_method,
        scope: query.scope,
        state: query.state,
      });
      return res.redirect(HttpStatus.FOUND, consentUrl);
    }

    let app;
    try {
      app = await this._oauthService.validateAuthorizationRequest(
        query.client_id
      );
    } catch (err) {
      // A registered DCR client that forgot PKCE deserves a precise error
      // instead of the generic "Invalid client_id" of the legacy table.
      const mcpClient = await this._mcpOAuthService.getClient(query.client_id);
      if (mcpClient) {
        throw new HttpException(
          {
            error: 'invalid_request',
            error_description:
              'PKCE (code_challenge with S256) is required for this client',
          },
          HttpStatus.BAD_REQUEST
        );
      }
      throw err;
    }

    // RFC 6749 §3.1.2.3: a client that sends a redirect_uri must get a mismatch
    // error rather than a silent redirect elsewhere.
    if (query.redirect_uri && query.redirect_uri !== app.redirectUrl) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: 'redirect_uri mismatch',
        },
        HttpStatus.BAD_REQUEST
      );
    }

    return {
      app: {
        name: app.name,
        description: app.description,
        picture: app.picture,
        clientId: app.clientId,
        redirectUrl: app.redirectUrl,
      },
      state: query.state,
    };
  }

  @Post('/token')
  async token(@Body() body: McpTokenDto) {
    if (body.grant_type === 'refresh_token') {
      return this._mcpOAuthService.refresh({
        refreshToken: body.refresh_token,
        clientId: body.client_id,
        clientSecret: body.client_secret,
      });
    }

    if (body.grant_type !== 'authorization_code') {
      throw new HttpException(
        { error: 'unsupported_grant_type' },
        HttpStatus.BAD_REQUEST
      );
    }

    // DCR clients always authenticate their code exchange with PKCE; legacy
    // OAuth apps use a client secret instead.
    const mcpClient = await this._mcpOAuthService.getClient(body.client_id);
    if (mcpClient) {
      return this._mcpOAuthService.exchangeCode({
        code: body.code,
        clientId: body.client_id,
        clientSecret: body.client_secret,
        codeVerifier: body.code_verifier,
        redirectUri: body.redirect_uri,
      });
    }

    if (!body.code || !body.client_secret) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: 'code and client_secret are required',
        },
        HttpStatus.BAD_REQUEST
      );
    }

    return this._oauthService.exchangeCodeForToken(
      body.code,
      body.client_id,
      body.client_secret
    );
  }
}

@ApiTags('OAuth')
@Controller('/oauth')
export class OAuthAuthorizedController {
  constructor(
    private _oauthService: OAuthService,
    private _mcpOAuthService: McpOAuthService
  ) {}

  private assertCanAuthorize(org: Organization) {
    // @ts-ignore - the auth middleware attaches the current membership.
    if (!['ADMIN', 'SUPERADMIN'].includes(org.users?.[0]?.role)) {
      throw new HttpException(
        'Only organization administrators can authorize OAuth applications',
        HttpStatus.FORBIDDEN
      );
    }
  }

  @Post('/authorize')
  async approveOrDeny(
    @Body() body: ApproveOAuthDto,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    this.assertCanAuthorize(org);

    const app = await this._oauthService.validateAuthorizationRequest(
      body.client_id
    );

    if (body.action === 'deny') {
      const redirectUrl = new URL(app.redirectUrl);
      redirectUrl.searchParams.set('error', 'access_denied');
      if (body.state) {
        redirectUrl.searchParams.set('state', body.state);
      }
      return { redirect: redirectUrl.toString() };
    }

    const code = await this._oauthService.createAuthorizationCode(
      app.id,
      user.id,
      org.id
    );

    const redirectUrl = new URL(app.redirectUrl);
    redirectUrl.searchParams.set('code', code);
    if (body.state) {
      redirectUrl.searchParams.set('state', body.state);
    }
    return { redirect: redirectUrl.toString() };
  }

  /** Consent-page data for an MCP authorization request. */
  @Get('/mcp-request/:id')
  async mcpConsentRequest(
    @Param('id') id: string,
    @GetUserFromRequest() user: User
  ) {
    const request = await this._mcpOAuthService.getConsentRequest(id);
    const organizations = await this._mcpOAuthService.getConsentOrganizations(
      user.id
    );
    return { ...request, organizations };
  }

  /** Approve or deny an MCP consent from the consent page. */
  @Post('/mcp-consent')
  async mcpConsent(
    @Body() body: McpConsentDto,
    @GetUserFromRequest() user: User
  ) {
    return this._mcpOAuthService.approveOrDeny({
      pendingId: body.request_id,
      userId: user.id,
      organizationId: body.organization_id,
      action: body.action,
      scopes: body.scopes,
    });
  }
}
