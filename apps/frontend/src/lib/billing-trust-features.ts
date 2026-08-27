import type { MessageKey } from './i18n';

export interface BillingTrustFeature {
  id: 'mfa' | 'encryptedCredentials' | 'recoveryCodes' | 'securityAuditLog';
  titleKey: MessageKey;
  bodyKey: MessageKey;
}

export const BILLING_TRUST_FEATURES = [
  {
    id: 'mfa',
    titleKey: 'billing.trust.mfa.title',
    bodyKey: 'billing.trust.mfa.body',
  },
  {
    id: 'encryptedCredentials',
    titleKey: 'billing.trust.encryptedCredentials.title',
    bodyKey: 'billing.trust.encryptedCredentials.body',
  },
  {
    id: 'recoveryCodes',
    titleKey: 'billing.trust.recoveryCodes.title',
    bodyKey: 'billing.trust.recoveryCodes.body',
  },
  {
    id: 'securityAuditLog',
    titleKey: 'billing.trust.securityAuditLog.title',
    bodyKey: 'billing.trust.securityAuditLog.body',
  },
] as const satisfies readonly BillingTrustFeature[];
