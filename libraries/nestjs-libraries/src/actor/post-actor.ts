export const POST_ACTOR_TYPES = ['USER', 'API_KEY', 'OAUTH_CLIENT', 'SYSTEM'] as const;
export type PostActorType = (typeof POST_ACTOR_TYPES)[number];

export type PostActor =
  | { type: 'USER'; userId: string }
  | { type: 'API_KEY'; apiKeyId: string | null }
  // userId = the human who authorized the grant
  | { type: 'OAUTH_CLIENT'; oauthClientId: string | null; userId?: string | null }
  | { type: 'SYSTEM' };

export const SYSTEM_ACTOR: PostActor = { type: 'SYSTEM' };

export type ActorPrefix = 'createdBy' | 'lastModifiedBy' | 'requestedBy';

export type ActorColumns<P extends ActorPrefix> = {
  [K in `${P}Type`]: PostActorType | null;
} & {
  [K in `${P}UserId` | `${P}ApiKeyId` | `${P}OAuthClientId`]: string | null;
};

export function actorToColumns<P extends ActorPrefix>(
  actor: PostActor,
  prefix: P
): ActorColumns<P> {
  const cols: Record<string, string | null> = {
    [`${prefix}Type`]: actor.type,
    [`${prefix}UserId`]: null,
    [`${prefix}ApiKeyId`]: null,
    [`${prefix}OAuthClientId`]: null,
  };
  if (actor.type === 'USER') {
    cols[`${prefix}UserId`] = actor.userId;
  } else if (actor.type === 'API_KEY') {
    cols[`${prefix}ApiKeyId`] = actor.apiKeyId;
  } else if (actor.type === 'OAUTH_CLIENT') {
    cols[`${prefix}OAuthClientId`] = actor.oauthClientId;
    cols[`${prefix}UserId`] = actor.userId ?? null;
  }
  return cols as ActorColumns<P>;
}

export type ActorView = {
  type: PostActorType;
  userId?: string;
  apiKeyId?: string;
  oauthClientId?: string;
};

export function actorViewFromColumns(
  row: Record<string, unknown> | null | undefined,
  prefix: ActorPrefix
): ActorView | null {
  const type = row?.[`${prefix}Type`];
  if (!row || typeof type !== 'string') {
    return null;
  }
  const view: ActorView = { type: type as PostActorType };
  const userId = row[`${prefix}UserId`];
  const apiKeyId = row[`${prefix}ApiKeyId`];
  const oauthClientId = row[`${prefix}OAuthClientId`];
  if (typeof userId === 'string') view.userId = userId;
  if (typeof apiKeyId === 'string') view.apiKeyId = apiKeyId;
  if (typeof oauthClientId === 'string') view.oauthClientId = oauthClientId;
  return view;
}

export type PublicApiCredentialLike = {
  type: 'legacy' | 'api-key' | 'oauth';
  id?: string;
  oauthClientId?: string;
  oauthUserId?: string;
};

export function actorFromPublicCredential(
  c: PublicApiCredentialLike | null | undefined
): PostActor {
  switch (c?.type) {
    case 'api-key':
      return { type: 'API_KEY', apiKeyId: c.id ?? null };
    case 'legacy':
      return { type: 'API_KEY', apiKeyId: null };
    case 'oauth':
      return c.oauthUserId
        ? {
            type: 'OAUTH_CLIENT',
            oauthClientId: c.oauthClientId ?? null,
            userId: c.oauthUserId,
          }
        : { type: 'OAUTH_CLIENT', oauthClientId: c.oauthClientId ?? null };
    default:
      return SYSTEM_ACTOR;
  }
}

export function actorFromUser(
  user: { id?: string | null } | null | undefined
): PostActor {
  return user?.id ? { type: 'USER', userId: user.id } : SYSTEM_ACTOR;
}
