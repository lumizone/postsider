import { HttpException } from '@nestjs/common';
import { OAuthAuthorizedController } from './oauth.controller';

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
