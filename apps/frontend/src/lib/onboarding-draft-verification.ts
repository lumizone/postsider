/**
 * Validate an actual stored DRAFT for this user's organization.
 *
 * The caller uses authenticated GET /posts/:id, whose backend already scopes
 * access by organization. The integration id is checked against the channels
 * read for that organization to avoid accepting an unrelated post.
 *
 * This proves the record exists, NOT that a specific MCP client authored it.
 * A prompt alone is never sufficient evidence of a completed write.
 */
export function isVerifiedOnboardingDraft(
  result: unknown,
  requestedId: string,
  connectedChannelIds: readonly string[],
): boolean {
  if (!requestedId || !connectedChannelIds.length || !result ||
      typeof result !== "object" || !("posts" in result)) return false;
  const posts = (result as { posts: unknown }).posts;
  if (!Array.isArray(posts)) return false;
  const known = new Set(connectedChannelIds);
  return posts.some((post: unknown) => {
    if (!post || typeof post !== "object") return false;
    const value = post as Record<string, unknown>;
    return value.id === requestedId &&
      value.state === "DRAFT" &&
      typeof value.integrationId === "string" &&
      known.has(value.integrationId);
  });
}
