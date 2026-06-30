/** Provider identifiers whose social provider implements comment(). Keep in sync with the providers. */
export const COMMENT_PROVIDERS: readonly string[] = [
  'bluesky', 'discord', 'facebook', 'instagram', 'instagram-standalone', 'kick',
  'lemmy', 'linkedin', 'linkedin-page', 'mastodon', 'mastodon-custom', 'moltbook',
  'nostr', 'reddit', 'skool', 'slack', 'telegram', 'threads', 'twitch', 'vk',
  'whop', 'wrapcast', 'x',
];
export function supportsComment(providerIdentifier: string): boolean {
  return COMMENT_PROVIDERS.includes((providerIdentifier ?? '').toLowerCase());
}
