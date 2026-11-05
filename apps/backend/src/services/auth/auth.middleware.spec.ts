import { AuthMiddleware } from './auth.middleware';
import {
  currentActor,
  currentImpersonator,
} from '@postsider/nestjs-libraries/actor/actor-context';
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

describe('AuthMiddleware actor binding', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalFlag = process.env.ALLOW_SUPERADMIN_IMPERSONATION;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFlag === undefined) delete process.env.ALLOW_SUPERADMIN_IMPERSONATION;
    else process.env.ALLOW_SUPERADMIN_IMPERSONATION = originalFlag;
  });

  afterAll(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  const recording = () => {
    const seen: any[] = [];
    const next = jest.fn(() => {
      seen.push({ actor: currentActor(), impersonator: currentImpersonator() });
    });
    return { seen, next };
  };

  it('binds the session user as a USER actor with no impersonator', async () => {
    jest.spyOn(AuthService, 'verifyJWT').mockReturnValue({ id: 'u1' } as any);
    const organizations = {
      getOrgsByUserId: jest.fn().mockResolvedValue([{ id: 'org-1', apiKey: 'k', users: [{ disabled: false }] }]),
    };
    const users = { getUserById: jest.fn().mockResolvedValue({ id: 'u1', activated: true }) };
    const mfa = { requiresEnrollment: jest.fn().mockResolvedValue(false) };
    const middleware = new AuthMiddleware(organizations as any, users as any, mfa as any);
    const { seen, next } = recording();
    await middleware.use({ headers: { auth: 'jwt' }, cookies: {} } as any, {} as any, next);
    expect(seen).toEqual([{ actor: { type: 'USER', userId: 'u1' }, impersonator: undefined }]);
  });

  it('binds the impersonated user and records the real super admin', async () => {
    process.env.ALLOW_SUPERADMIN_IMPERSONATION = 'true';
    jest.spyOn(AuthService, 'verifyJWT').mockReturnValue({ id: 'admin-1' } as any);
    const organizations = {
      getUserOrg: jest.fn().mockResolvedValue({
        user: { id: 'u9' },
        organization: { id: 'org-9', users: [{ userId: 'u9' }] },
      }),
    };
    const users = {
      getUserById: jest.fn().mockResolvedValue({ id: 'admin-1', activated: true, isSuperAdmin: true }),
    };
    const mfa = { requiresEnrollment: jest.fn().mockResolvedValue(false) };
    const middleware = new AuthMiddleware(organizations as any, users as any, mfa as any);
    const { seen, next } = recording();
    await middleware.use(
      { headers: { auth: 'jwt' }, cookies: { impersonate: 'u9' } } as any,
      {} as any,
      next
    );
    expect(seen).toEqual([{ actor: { type: 'USER', userId: 'u9' }, impersonator: 'admin-1' }]);
  });
});
