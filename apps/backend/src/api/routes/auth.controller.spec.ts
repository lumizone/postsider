jest.mock('qrcode', () => ({ toDataURL: jest.fn() }), { virtual: true });
jest.mock('otpauth', () => ({}), { virtual: true });

import { AuthController } from './auth.controller';
import { AuthService as AuthChecker } from '@postsider/helpers/auth/auth.service';

const makeResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
  send: jest.fn(),
  cookie: jest.fn(),
  header: jest.fn(),
});

describe('AuthController MFA policy login gate', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalNotSecured = process.env.NOT_SECURED;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    // The enrollment challenge signs a real JWT, so the secret has to be set
    // here rather than inherited. Without this the suite passes only on a
    // machine whose repo-root .env happens to define JWT_SECRET (a dev box)
    // and fails on the production host and any clean CI runner with
    // "secretOrPrivateKey must have a value".
    process.env.JWT_SECRET = 'test-jwt-secret-for-enrollment-challenge';
    delete process.env.NOT_SECURED;
  });

  afterAll(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
    process.env.NOT_SECURED = originalNotSecured;
    process.env.JWT_SECRET = originalJwtSecret;
  });

  it('issues only a five-minute httpOnly enrollment challenge after a valid first factor', async () => {
    const auth = {
      getOrgFromCookie: jest.fn().mockReturnValue(false),
      routeAuth: jest.fn().mockResolvedValue({
        addedOrg: false,
        user: { id: 'user-1', email: 'person@example.com', mfaEnabledAt: null },
      }),
      issueSession: jest.fn(),
    };
    const audit = { logAuthEvent: jest.fn() };
    const mfa = { requiresEnrollment: jest.fn().mockResolvedValue(true) };
    const controller = new AuthController(auth as any, {} as any, audit as any, mfa as any);
    const response = makeResponse();

    await controller.login(
      { cookies: {} } as any,
      { provider: 'LOCAL', email: 'person@example.com', password: 'password' } as any,
      response as any,
      '127.0.0.1',
      'test-agent'
    );

    expect(response.status).toHaveBeenCalledWith(202);
    expect(response.json).toHaveBeenCalledWith({ mfaEnrollmentRequired: true });
    expect(response.cookie).toHaveBeenCalledWith(
      'mfa_enroll',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, maxAge: 5 * 60 * 1000 })
    );
    expect(auth.issueSession).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin anonymous enrollment begin even with a valid challenge cookie', async () => {
    const auth = { getUserById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'person@example.com', mfaEnabledAt: null }) };
    const audit = { logAuthEvent: jest.fn() };
    const mfa = {
      requiresEnrollment: jest.fn().mockResolvedValue(true),
      beginEnrollment: jest.fn(),
    };
    const controller = new AuthController(auth as any, {} as any, audit as any, mfa as any);
    const response = makeResponse();
    jest.spyOn(AuthChecker, 'verifyJWT').mockReturnValue({ purpose: 'mfa_enrollment', userId: 'user-1' } as any);

    await controller.beginMfaEnrollment(
      { cookies: { mfa_enroll: 'challenge' }, headers: { origin: 'https://attacker.example' } } as any,
      response as any
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(mfa.beginEnrollment).not.toHaveBeenCalled();
  });

  it('allows anonymous enrollment begin only with an enrollment challenge from the configured origin', async () => {
    const auth = { getUserById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'person@example.com', mfaEnabledAt: null }) };
    const audit = { logAuthEvent: jest.fn() };
    const mfa = {
      requiresEnrollment: jest.fn().mockResolvedValue(true),
      beginEnrollment: jest.fn().mockResolvedValue({ qrCodeDataUrl: 'data:image/png', manualKey: 'SECRET' }),
    };
    const controller = new AuthController(auth as any, {} as any, audit as any, mfa as any);
    const response = makeResponse();
    jest.spyOn(AuthChecker, 'verifyJWT').mockReturnValue({ purpose: 'mfa_enrollment', userId: 'user-1' } as any);

    await controller.beginMfaEnrollment(
      { cookies: { mfa_enroll: 'challenge' }, headers: { origin: 'https://app.example.com' } } as any,
      response as any
    );

    expect(mfa.beginEnrollment).toHaveBeenCalledWith('user-1', 'person@example.com');
    expect(response.json).toHaveBeenCalledWith({ qrCodeDataUrl: 'data:image/png', manualKey: 'SECRET' });
  });

  it('rejects a cross-origin enrollment confirmation before it can enable MFA or issue a session', async () => {
    const auth = {
      getUserById: jest.fn(),
      issueSession: jest.fn(),
    };
    const audit = { logAuthEvent: jest.fn() };
    const mfa = {
      requiresEnrollment: jest.fn(),
      confirmEnrollment: jest.fn(),
    };
    const controller = new AuthController(auth as any, {} as any, audit as any, mfa as any);
    const response = makeResponse();

    await controller.confirmMfaEnrollment(
      { cookies: { mfa_enroll: 'challenge' }, headers: { origin: 'https://attacker.example' } } as any,
      '123456',
      response as any
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(mfa.confirmEnrollment).not.toHaveBeenCalled();
    expect(auth.issueSession).not.toHaveBeenCalled();
  });

  it('confirms enrollment, clears the challenge, and issues a session only after a valid TOTP code', async () => {
    const user = { id: 'user-1', email: 'person@example.com', mfaEnabledAt: null };
    const auth = {
      getUserById: jest.fn().mockResolvedValue(user),
      issueSession: jest.fn().mockResolvedValue('session-jwt'),
    };
    const audit = { logAuthEvent: jest.fn() };
    const mfa = {
      requiresEnrollment: jest.fn().mockResolvedValue(true),
      confirmEnrollment: jest.fn().mockResolvedValue({ recoveryCodes: ['CODE-1'] }),
    };
    const controller = new AuthController(auth as any, {} as any, audit as any, mfa as any);
    const response = makeResponse();
    jest.spyOn(AuthChecker, 'verifyJWT').mockReturnValue({ purpose: 'mfa_enrollment', userId: 'user-1' } as any);

    await controller.confirmMfaEnrollment(
      { cookies: { mfa_enroll: 'challenge' }, headers: { origin: 'https://app.example.com' } } as any,
      '123456',
      response as any
    );

    expect(mfa.confirmEnrollment).toHaveBeenCalledWith('user-1', '123456');
    expect(auth.issueSession).toHaveBeenCalledWith(user);
    expect(response.cookie).toHaveBeenCalledWith(
      'mfa_enroll',
      '',
      expect.objectContaining({ httpOnly: true, maxAge: -1, expires: new Date(0) })
    );
    expect(response.json).toHaveBeenCalledWith({ recoveryCodes: ['CODE-1'] });
    const [challengeClearCall, authCookieCall] = response.cookie.mock.calls;
    expect(challengeClearCall[0]).toBe('mfa_enroll');
    expect(authCookieCall[0]).toBe('auth');
    expect(
      response.cookie.mock.invocationCallOrder[0]
    ).toBeLessThan(response.cookie.mock.invocationCallOrder[1]);
  });
});
