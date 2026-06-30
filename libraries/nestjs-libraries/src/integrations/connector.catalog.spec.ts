import {
  ConnectorCatalogService,
  SOURCE_CAPABLE_CONNECTORS,
} from '@postsider/nestjs-libraries/integrations/connector.catalog';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';

function makeCatalog() {
  // IntegrationManager has no constructor deps that matter for the catalog.
  return new ConnectorCatalogService(new IntegrationManager());
}

describe('ConnectorCatalogService', () => {
  const catalog = makeCatalog().getCatalog();

  it('Property 3: every connector declares at least one capability', () => {
    expect(catalog.length).toBeGreaterThan(0);
    for (const connector of catalog) {
      expect(connector.capabilities.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('Property 4: every SOURCE connector is registered as source-capable', () => {
    const sourceConnectors = catalog.filter((c) =>
      c.capabilities.includes('SOURCE')
    );
    for (const connector of sourceConnectors) {
      expect(SOURCE_CAPABLE_CONNECTORS.has(connector.identifier)).toBe(true);
    }
  });

  it('includes email connectors with capabilities', () => {
    const ids = new Set(catalog.map((c) => c.identifier));
    expect(ids.has('resend')).toBe(true);
    expect(ids.has('smtp')).toBe(true);
  });

  it('listForOrganization marks authorization status', () => {
    const service = makeCatalog();
    const authorized = new Set<string>(['linkedin']);
    const list = service.listForOrganization(authorized);
    const linkedin = list.find((c) => c.identifier === 'linkedin');
    const discord = list.find((c) => c.identifier === 'discord');
    expect(linkedin?.authorized).toBe(true);
    expect(discord?.authorized).toBe(false);
  });
});
