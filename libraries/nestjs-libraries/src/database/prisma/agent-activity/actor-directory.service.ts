import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import type { ActorView } from '@postsider/nestjs-libraries/actor/post-actor';
import { cleanDisplayName } from '@postsider/nestjs-libraries/agent-activity/display-name';

export type ActorDisplay = {
  type: 'USER' | 'API_KEY' | 'OAUTH_CLIENT' | 'SYSTEM';
  id: string | null;
  name: string | null;
  state: 'ok' | 'revoked' | 'unknown' | 'legacy';
  authorizedBy: string | null;
};

export type ActorResolver = (
  view: ActorView | null | undefined
) => ActorDisplay | null;

type KeyRow = { id: string; name: string; deletedAt: Date | null };
type NamedRow = { id: string; name: string };

@Injectable()
export class ActorDirectoryService {
  constructor(
    private _members: PrismaRepository<'userOrganization'>,
    private _apiKeys: PrismaRepository<'apiKey'>,
    private _mcpClients: PrismaRepository<'mcpOAuthClient'>,
    private _oauthApps: PrismaRepository<'oAuthApp'>
  ) {}

  async resolve(
    orgId: string,
    views: ReadonlyArray<ActorView | null | undefined>
  ): Promise<ActorResolver> {
    const userIds = new Set<string>();
    const keyIds = new Set<string>();
    const clientIds = new Set<string>();
    for (const v of views) {
      if (!v) continue;
      if ((v.type === 'USER' || v.type === 'OAUTH_CLIENT') && v.userId) {
        userIds.add(v.userId);
      }
      if (v.type === 'API_KEY' && v.apiKeyId) keyIds.add(v.apiKeyId);
      if (v.type === 'OAUTH_CLIENT' && v.oauthClientId) {
        clientIds.add(v.oauthClientId);
      }
    }

    const [members, keys, mcpClients, apps] = await Promise.all([
      userIds.size
        ? this._members.model.userOrganization.findMany({
            where: { organizationId: orgId, userId: { in: [...userIds] } },
            select: {
              userId: true,
              user: { select: { name: true, lastName: true, email: true } },
            },
          })
        : [],
      keyIds.size
        ? this._apiKeys.model.apiKey.findMany({
            where: { organizationId: orgId, id: { in: [...keyIds] } },
            select: { id: true, name: true, deletedAt: true },
          })
        : [],
      clientIds.size
        ? this._mcpClients.model.mcpOAuthClient.findMany({
            where: { id: { in: [...clientIds] } },
            select: { id: true, name: true },
          })
        : [],
      clientIds.size
        ? this._oauthApps.model.oAuthApp.findMany({
            where: { organizationId: orgId, id: { in: [...clientIds] } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const userNames = new Map<string, string | null>();
    for (const m of members as Array<{
      userId: string;
      user: { name: string | null; lastName: string | null; email: string };
    }>) {
      const full = [m.user.name, m.user.lastName].filter(Boolean).join(' ');
      userNames.set(m.userId, cleanDisplayName(full) ?? cleanDisplayName(m.user.email));
    }
    const keyById = new Map((keys as KeyRow[]).map((k) => [k.id, k]));
    const clientNames = new Map<string, string | null>();
    for (const c of [...(mcpClients as NamedRow[]), ...(apps as NamedRow[])]) {
      if (!clientNames.has(c.id)) clientNames.set(c.id, cleanDisplayName(c.name));
    }

    return (view) => {
      if (!view) return null;
      switch (view.type) {
        case 'USER': {
          const id = view.userId ?? null;
          const known = id !== null && userNames.has(id);
          return {
            type: 'USER',
            id,
            name: known ? userNames.get(id as string) ?? null : null,
            state: known ? 'ok' : 'unknown',
            authorizedBy: null,
          };
        }
        case 'API_KEY': {
          const id = view.apiKeyId ?? null;
          if (id === null) {
            return { type: 'API_KEY', id, name: null, state: 'legacy', authorizedBy: null };
          }
          const key = keyById.get(id);
          if (!key) {
            return { type: 'API_KEY', id, name: null, state: 'unknown', authorizedBy: null };
          }
          return {
            type: 'API_KEY',
            id,
            name: cleanDisplayName(key.name),
            state: key.deletedAt ? 'revoked' : 'ok',
            authorizedBy: null,
          };
        }
        case 'OAUTH_CLIENT': {
          const id = view.oauthClientId ?? null;
          const known = id !== null && clientNames.has(id);
          return {
            type: 'OAUTH_CLIENT',
            id,
            name: known ? clientNames.get(id as string) ?? null : null,
            state: known ? 'ok' : 'unknown',
            authorizedBy: view.userId ? userNames.get(view.userId) ?? null : null,
          };
        }
        default:
          return { type: 'SYSTEM', id: null, name: null, state: 'ok', authorizedBy: null };
      }
    };
  }
}
