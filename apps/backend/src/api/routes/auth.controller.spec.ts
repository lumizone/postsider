import { AuthController } from './auth.controller';

describe('AuthController MFA policy login gate', () => {
  it('returns mfaEnrollmentRequired without issuing a session when global enrollment is enforced', async () => {
    const auth = {
      getOrgFromCookie: jest.fn().mockReturnValue(false),
      routeAuth: jest.fn().mockResolvedValue({
        addedOrg: false,
        user: { id: 'user-1', mfaEnabledAt: null },
      }),
      issueSession: jest.fn(),
    };
    const audit = { logAuthEvent: jest.fn() };
    const mfa = { requiresEnrollment: jest.fn().mockResolvedValue(true) };
    const controller = new AuthController(auth as any, {} as any, audit as any, mfa as any);
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn(), cookie: jest.fn(), header: jest.fn() };

    await controller.login({ cookies: {} } as any, { provider: 'LOCAL', email: 'person@example.com', password: 'password' } as any, response as any, '127.0.0.1', 'test-agent');

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ mfaEnrollmentRequired: true });
    expect(auth.issueSession).not.toHaveBeenCalled();
    expect(auth.routeAuth).toHaveBeenCalledWith('LOCAL', expect.anything(), '127.0.0.1', 'test-agent', false, false);
  });
});
