// Pure: builds the `Channel` the post preview panel needs from a detail destination.
import type { Channel } from './calendar-data';

export function destinationToChannel(
  d: { integrationId: string; integrationName: string; providerIdentifier: string; picture: string | null },
  platformOf: (identifier: string) => string
): Channel {
  return {
    id: d.integrationId,
    name: d.integrationName,
    platform: platformOf(d.providerIdentifier),
    identifier: d.providerIdentifier,
    color: '#0F0F0F',
    avatarUrl: d.picture,
    audience: 0,
    audienceHistory: [],
  };
}
