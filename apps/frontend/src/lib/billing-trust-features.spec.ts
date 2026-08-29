import { BILLING_TRUST_FEATURES } from './billing-trust-features';

describe('BILLING_TRUST_FEATURES', () => {
  it('defines the four billing trust highlights', () => {
    expect(BILLING_TRUST_FEATURES.map((feature) => feature.id)).toEqual([
      'mfa',
      'encryptedCredentials',
      'recoveryCodes',
      'securityAuditLog',
    ]);
  });

  it('keeps every customer-facing claim in the billing i18n namespace', () => {
    for (const feature of BILLING_TRUST_FEATURES) {
      expect(feature.titleKey).toMatch(/^billing\.trust\./);
      expect(feature.bodyKey).toMatch(/^billing\.trust\./);
    }
  });
});
