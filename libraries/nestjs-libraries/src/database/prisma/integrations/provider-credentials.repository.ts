import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class ProviderCredentialsRepository {
  constructor(
    private _repo: PrismaRepository<'providerCredentials'>,
  ) {}

  async getByOrgAndProvider(orgId: string, provider: string) {
    return this._repo.model.providerCredentials.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider } },
    });
  }

  async getAllByOrg(orgId: string) {
    return this._repo.model.providerCredentials.findMany({
      where: { organizationId: orgId },
    });
  }

  async upsert(
    orgId: string,
    provider: string,
    clientId: string,
    clientSecret: string,
    extraData?: string,
  ) {
    return this._repo.model.providerCredentials.upsert({
      where: { organizationId_provider: { organizationId: orgId, provider } },
      create: {
        organizationId: orgId,
        provider,
        clientId,
        clientSecret,
        extraData,
      },
      update: {
        clientId,
        clientSecret,
        extraData,
      },
    });
  }

  async delete(orgId: string, provider: string) {
    return this._repo.model.providerCredentials.deleteMany({
      where: { organizationId: orgId, provider },
    });
  }
}
