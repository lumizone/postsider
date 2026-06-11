import { InboundSourceRegistry } from '@postsider/nestjs-libraries/integrations/inbound/inbound.registry';
import { SOURCE_CAPABLE_CONNECTORS } from '@postsider/nestjs-libraries/integrations/connector.catalog';

function makeRegistry() {
  // The registry only needs getIntegrationsList at fetch-time; construction
  // just registers handlers, so a stub integration service is enough.
  const stub = { getIntegrationsList: async () => [] } as any;
  return new InboundSourceRegistry(stub);
}

describe('InboundSourceRegistry', () => {
  it('Property 4: every SOURCE-capable connector has a registered handler', () => {
    const registry = makeRegistry();
    for (const source of SOURCE_CAPABLE_CONNECTORS) {
      expect(registry.has(source)).toBe(true);
    }
  });

  it('returns an empty page for a source with no connected integration', async () => {
    const registry = makeRegistry();
    const anySource = [...SOURCE_CAPABLE_CONNECTORS][0];
    const page = await registry.fetch('org1', anySource);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('throws for an unregistered source', () => {
    const registry = makeRegistry();
    expect(() => registry.fetch('org1', 'not-a-source')).toThrow();
  });
});
