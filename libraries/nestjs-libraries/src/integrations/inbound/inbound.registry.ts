import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { SOURCE_CAPABLE_CONNECTORS } from '@postsider/nestjs-libraries/integrations/connector.catalog';
import {
  InboundSourceHandler,
  InboundSourcePage,
} from '@postsider/nestjs-libraries/integrations/inbound/inbound.source.interface';

/**
 * Generic pull handler. Looks up the organization's connected integration for
 * the given source and, when the underlying provider exposes a pull method
 * (`fetchInbound`), delegates to it. Providers that do not yet implement a pull
 * method return an empty page rather than throwing, so the bridge contract
 * stays stable while individual providers are filled in incrementally.
 */
class GenericInboundHandler implements InboundSourceHandler {
  constructor(
    public readonly source: string,
    private readonly _integrationService: IntegrationService
  ) {}

  async fetch(
    organizationId: string,
    cursor?: string,
    limit = 25
  ): Promise<InboundSourcePage> {
    const integrations = await this._integrationService.getIntegrationsList(
      organizationId
    );
    const integration = (integrations || []).find(
      (i: any) => i.providerIdentifier === this.source && !i.disabled
    );
    if (!integration) {
      return { items: [], nextCursor: null };
    }

    // Provider-specific pull is optional; when present we delegate to it.
    const provider: any = (this._integrationService as any)._integrationManager?.getSocialIntegration?.(
      this.source
    );
    if (provider && typeof provider.fetchInbound === 'function') {
      return provider.fetchInbound(integration, cursor, limit);
    }

    return { items: [], nextCursor: null };
  }
}

/**
 * Registry of inbound source handlers (Requirement 13.5). Guarantees that every
 * SOURCE-capable connector has a registered handler (Correctness Property 4).
 */
@Injectable()
export class InboundSourceRegistry {
  private readonly handlers = new Map<string, InboundSourceHandler>();

  constructor(private _integrationService: IntegrationService) {
    for (const source of SOURCE_CAPABLE_CONNECTORS) {
      this.handlers.set(
        source,
        new GenericInboundHandler(source, this._integrationService)
      );
    }
  }

  has(source: string): boolean {
    return this.handlers.has(source);
  }

  getRegisteredSources(): string[] {
    return [...this.handlers.keys()];
  }

  /** Fetch a page of items from a source (Requirement 14.7). */
  fetch(
    organizationId: string,
    source: string,
    cursor?: string,
    limit?: number
  ): Promise<InboundSourcePage> {
    const handler = this.handlers.get(source);
    if (!handler) {
      throw new Error(`No inbound handler registered for source "${source}"`);
    }
    return handler.fetch(organizationId, cursor, limit);
  }
}
