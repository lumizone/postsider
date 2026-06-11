import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { Capability, Prisma } from '@prisma/client';

export interface AgentTokenScope {
  connectors: string[];
  capabilities: Capability[];
  expiresAt?: Date | null;
  rateLimitPerMinute?: number;
  rateLimitPerDay?: number;
}

@Injectable()
export class AgentTokenRepository {
  constructor(private _agentToken: PrismaRepository<'agentToken'>) {}

  create(
    organizationId: string,
    name: string,
    tokenHash: string,
    scope: AgentTokenScope
  ) {
    return this._agentToken.model.agentToken.create({
      data: {
        organizationId,
        name,
        tokenHash,
        connectors: scope.connectors,
        capabilities: scope.capabilities,
        ...(scope.expiresAt ? { expiresAt: scope.expiresAt } : {}),
        ...(scope.rateLimitPerMinute != null
          ? { rateLimitPerMinute: scope.rateLimitPerMinute }
          : {}),
        ...(scope.rateLimitPerDay != null
          ? { rateLimitPerDay: scope.rateLimitPerDay }
          : {}),
      },
      select: {
        id: true,
        name: true,
        connectors: true,
        capabilities: true,
        expiresAt: true,
        rateLimitPerMinute: true,
        rateLimitPerDay: true,
        createdAt: true,
      },
    });
  }

  findByHash(tokenHash: string) {
    return this._agentToken.model.agentToken.findUnique({
      where: { tokenHash },
      include: {
        organization: {
          include: {
            subscription: {
              select: {
                subscriptionTier: true,
                totalChannels: true,
                isLifetime: true,
              },
            },
          },
        },
      },
    });
  }

  listByOrg(organizationId: string) {
    return this._agentToken.model.agentToken.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        connectors: true,
        capabilities: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        rateLimitPerMinute: true,
        rateLimitPerDay: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  revoke(organizationId: string, id: string) {
    return this._agentToken.model.agentToken.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  touchLastUsed(id: string) {
    return this._agentToken.model.agentToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
