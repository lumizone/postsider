import { MfaController } from './mfa.controller';

describe('MfaController global policy authorization', () => {
  const policy = { enforceForAll: true };

  it('rejects an organization owner who is not a platform superadmin', async () => {
    const mfa = { getPolicy: jest.fn(), updatePolicy: jest.fn().mockResolvedValue(policy) };
    const audit = { logSecurityEvent: jest.fn() };
    const controller = new MfaController(mfa as any, audit as any);
    const organizationOwner = { id: 'org-1', users: [{ role: 'SUPERADMIN' }] };
    const tenantOwner = { id: 'user-1', isSuperAdmin: false };

    await expect(controller.policy(tenantOwner as any)).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.updatePolicy(organizationOwner as any, tenantOwner as any, true)
    ).rejects.toMatchObject({ status: 403 });

    expect(mfa.getPolicy).not.toHaveBeenCalled();
    expect(mfa.updatePolicy).not.toHaveBeenCalled();
    expect(audit.logSecurityEvent).not.toHaveBeenCalled();
  });

  it('allows a platform superadmin to read and update the global policy', async () => {
    const mfa = {
      getPolicy: jest.fn().mockResolvedValue({ enforceForAll: false }),
      updatePolicy: jest.fn().mockResolvedValue(policy),
    };
    const audit = { logSecurityEvent: jest.fn() };
    const controller = new MfaController(mfa as any, audit as any);
    const platformSuperadmin = { id: 'platform-user-1', isSuperAdmin: true };
    const organization = { id: 'org-1' };

    await expect(controller.policy(platformSuperadmin as any)).resolves.toEqual({ enforceForAll: false });
    await expect(
      controller.updatePolicy(organization as any, platformSuperadmin as any, true)
    ).resolves.toEqual(policy);

    expect(mfa.updatePolicy).toHaveBeenCalledWith(true);
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(
      'org-1',
      'mfa.policy_updated',
      'platform-user-1',
      { enforceForAll: true }
    );
  });
});
