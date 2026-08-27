import { AuthMiddleware } from './auth.middleware';
import { AuthService } from '@postsider/helpers/auth/auth.service';

describe('AuthMiddleware MFA policy gate', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    jest.spyOn(AuthService, 'verifyJWT').mockReturnValue({ id: 'user-1' } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('revokes a pre-existing full session when global MFA enrollment is required', async () => {
    const organizations = { getOrgsByUserId: jest.fn() };
    const users = {
      getUserById: jest.fn().mockResolvedValue({
        id: 'user-1',
        activated: true,
        mfaEnabledAt: null,
      }),
    };
    const mfa = { requiresEnrollment: jest.fn().mockResolvedValue(true) };
    const middleware = new AuthMiddleware(organizations as any, users as any, mfa as any);
    const response = { cookie: jest.fn(), header: jest.fn() };
    const next = jest.fn();

    await expect(
      middleware.use({ headers: { auth: 'existing-session' }, cookies: {} } as any, response as any, next)
    ).rejects.toThrow();

    expect(mfa.requiresEnrollment).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }));
    expect(response.cookie).toHaveBeenCalledWith(
      'auth',
      '',
      expect.objectContaining({ maxAge: -1, expires: new Date(0) })
    );
    expect(response.header).toHaveBeenCalledWith('logout', 'true');
    expect(next).not.toHaveBeenCalled();
    expect(organizations.getOrgsByUserId).not.toHaveBeenCalled();
  });
});
