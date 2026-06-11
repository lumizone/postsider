import { Injectable } from '@nestjs/common';
import { Capability } from '@prisma/client';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@postsider/nestjs-libraries/integrations/integration.manager';

export interface ConnectorDefinition {
  identifier: string;
  label: string;
  iconUrl: string;
  capabilities: Capability[];
  /** OAuth scopes required, grouped by capability (best-effort). */
  requiredScopes: string[];
}

/**
 * Connectors that can act as an Inbound_Source (Requirement 13.5). Each one
 * MUST have a registered handler in the InboundSourceRegistry.
 */
export const SOURCE_CAPABLE_CONNECTORS = new Set<string>([
  'reddit',
  'discord',
  'skool',
  // email connectors
  'gmail',
  'mailgun',
  'resend',
  'smtp',
]);

/**
 * Email connectors are not part of socialIntegrationList; declare them here so
 * the catalog can expose them with their capabilities (Requirement 13.2).
 */
const EMAIL_CONNECTORS: ConnectorDefinition[] = [
  {
    identifier: 'resend',
    label: 'Resend',
    iconUrl: '/icons/connectors/resend.png',
    capabilities: ['PUBLISH', 'SOURCE'],
    requiredScopes: [],
  },
  {
    identifier: 'mailgun',
    label: 'Mailgun',
    iconUrl: '/icons/connectors/mailgun.png',
    capabilities: ['PUBLISH', 'SOURCE'],
    requiredScopes: [],
  },
  {
    identifier: 'gmail',
    label: 'Gmail',
    iconUrl: '/icons/connectors/gmail.png',
    capabilities: ['PUBLISH', 'SOURCE'],
    requiredScopes: ['https://www.googleapis.com/auth/gmail.send'],
  },
  {
    identifier: 'smtp',
    label: 'SMTP',
    iconUrl: '/icons/connectors/smtp.png',
    capabilities: ['PUBLISH'],
    requiredScopes: [],
  },
];

@Injectable()
export class ConnectorCatalogService {
  constructor(private _integrationManager: IntegrationManager) {}

  /**
   * Derive the capabilities of a social provider instance.
   * - PUBLISH: every social provider implements `post`.
   * - SCHEDULE: every provider is schedulable through Temporal.
   * - ANALYTICS: provider implements the optional `analytics` method.
   * - SOURCE: provider is in SOURCE_CAPABLE_CONNECTORS.
   */
  private deriveCapabilities(provider: any): Capability[] {
    const caps: Capability[] = [];
    if (typeof provider.post === 'function') caps.push('PUBLISH');
    // All connectors support scheduling via the orchestrator.
    caps.push('SCHEDULE');
    if (typeof provider.analytics === 'function') caps.push('ANALYTICS');
    if (SOURCE_CAPABLE_CONNECTORS.has(provider.identifier)) caps.push('SOURCE');
    return caps;
  }

  /** The full connector catalog (social + email). */
  getCatalog(): ConnectorDefinition[] {
    const social = socialIntegrationList.map((p) => ({
      identifier: p.identifier,
      label: p.name,
      iconUrl: `/icons/connectors/${p.identifier}.png`,
      capabilities: this.deriveCapabilities(p),
      requiredScopes: p.scopes ?? [],
    }));

    // Email connectors not already represented as a social provider.
    const socialIds = new Set(social.map((c) => c.identifier));
    const email = EMAIL_CONNECTORS.filter((c) => !socialIds.has(c.identifier));

    return [...social, ...email];
  }

  getConnector(identifier: string): ConnectorDefinition | undefined {
    return this.getCatalog().find((c) => c.identifier === identifier);
  }

  /**
   * Return the catalog filtered to the connectors the organization has
   * authorized (Requirement 13.4, 14.1). `authorizedIdentifiers` is the set of
   * provider identifiers the org currently has connected.
   */
  listForOrganization(
    authorizedIdentifiers: Set<string>
  ): Array<ConnectorDefinition & { authorized: boolean }> {
    return this.getCatalog().map((c) => ({
      ...c,
      authorized: authorizedIdentifiers.has(c.identifier),
    }));
  }
}
