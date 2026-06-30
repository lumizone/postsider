/** A single item pulled from an inbound source (email, Reddit thread, etc.). */
export interface InboundSourceItem {
  id: string;
  source: string;
  type: string;
  title?: string;
  body?: string;
  author?: string;
  url?: string;
  createdAt?: string;
  raw?: unknown;
}

/** A page of inbound items with an opaque cursor for the next page. */
export interface InboundSourcePage {
  items: InboundSourceItem[];
  nextCursor: string | null;
}

/**
 * A handler that knows how to pull content from one inbound source for an
 * organization. Implementations call the underlying provider API using the
 * org's stored integration credentials.
 */
export interface InboundSourceHandler {
  /** Connector identifier this handler serves (e.g. "discord"). */
  readonly source: string;
  /**
   * Fetch a page of items. `cursor` is the opaque value returned as
   * `nextCursor` by the previous call (undefined for the first page).
   */
  fetch(
    organizationId: string,
    cursor?: string,
    limit?: number
  ): Promise<InboundSourcePage>;
}
