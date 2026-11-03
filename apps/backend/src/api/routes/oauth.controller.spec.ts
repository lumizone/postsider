import { HttpException, HttpStatus } from '@nestjs/common';
import { OAuthAuthorizedController, OAuthController } from './oauth.controller';
import { McpOAuthController } from './mcp-oauth.controller';

describe('OAuthAuthorizedController authorization role', () => {
  const app = {
    id: 'app-1',
    redirectUrl: 'https://client.example.com/callback',
  };

  const createController = () => {
    const service = {
      validateAuthorizationRequest: jest.fn().mockResolvedValue(app),
      createAuthorizationCode: jest.fn().mockResolvedValue('code-1'),
    };
    return {
      controller: new OAuthAuthorizedController(service as any),
      service,
    };
  };

  it('rejects a USER before creating an authorization', async () => {
    const { controller, service } = createController();

    await expect(
      controller.approveOrDeny(
        { client_id: 'client-1', action: 'approve' } as any,
        { id: 'user-1' } as any,
        { id: 'org-1', users: [{ role: 'USER' }] } as any
      )
    ).rejects.toMatchObject<HttpException>({ status: 403 });

    expect(service.validateAuthorizationRequest).not.toHaveBeenCalled();
    expect(service.createAuthorizationCode).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'SUPERADMIN'])(
    'allows %s to authorize an app',
    async (role) => {
      const { controller, service } = createController();

      await expect(
        controller.approveOrDeny(
          { client_id: 'client-1', action: 'approve' } as any,
          { id: 'user-1' } as any,
          { id: 'org-1', users: [{ role }] } as any
        )
      ).resolves.toEqual({
        redirect: 'https://client.example.com/callback?code=code-1',
      });

      expect(service.createAuthorizationCode).toHaveBeenCalledWith(
        'app-1',
        'user-1',
        'org-1'
      );
    }
  );
});

/**
 * Strict OAuth clients (oauth4webapi, used by Smithery) require the exact
 * status code from the RFC; NestJS defaults @Post to 201, which made Smithery
 * reject a valid token response and loop on "authentication required".
 */
describe('OAuth endpoint HTTP status conformance', () => {
  const httpCode = (handler: unknown) =>
    Reflect.getMetadata('__httpCode__', handler as object);

  it('token endpoint returns 200 (RFC 6749 §5.1), not the default 201', () => {
    expect(httpCode(OAuthController.prototype.token)).toBe(HttpStatus.OK);
  });

  it('introspection returns 200 (RFC 7662 §2.2)', () => {
    expect(httpCode(McpOAuthController.prototype.introspect)).toBe(
      HttpStatus.OK
    );
  });

  it('revocation returns 200 (RFC 7009 §2.2)', () => {
    expect(httpCode(McpOAuthController.prototype.revoke)).toBe(HttpStatus.OK);
  });

  it('dynamic client registration keeps the default 201 (RFC 7591 §3.2.1)', () => {
    // No explicit @HttpCode here on purpose: NestJS's POST default of 201 is
    // exactly what RFC 7591 (and oauth4webapi) require for DCR.
    expect(httpCode(McpOAuthController.prototype.register)).toBeUndefined();
  });
});
