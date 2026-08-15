import { Injectable } from '@nestjs/common';
import { ProviderCredentialsRepository } from './provider-credentials.repository';
import { AuthService } from '@postsider/helpers/auth/auth.service';

@Injectable()
export class ProviderCredentialsService {
  constructor(private _repo: ProviderCredentialsRepository) {}

  async getCredentials(orgId: string, provider: string) {
    const row = await this._repo.getByOrgAndProvider(orgId, provider);
    if (!row) return null;
    return {
      clientId: row.clientId,
      clientSecret: AuthService.decryptSecret(row.clientSecret),
      extraData: row.extraData ? JSON.parse(row.extraData) : undefined,
    };
  }

  async hasCredentials(orgId: string, provider: string): Promise<boolean> {
    const row = await this._repo.getByOrgAndProvider(orgId, provider);
    return !!row;
  }

  async getAllConfigured(orgId: string): Promise<string[]> {
    const rows = await this._repo.getAllByOrg(orgId);
    return rows.map((r: { provider: string }) => r.provider);
  }

  async saveCredentials(
    orgId: string,
    provider: string,
    clientId: string,
    clientSecret: string,
    extraData?: Record<string, any>,
  ) {
    return this._repo.upsert(
      orgId,
      provider,
      clientId,
      AuthService.encryptSecret(clientSecret),
      extraData ? JSON.stringify(extraData) : undefined,
    );
  }

  async deleteCredentials(orgId: string, provider: string) {
    return this._repo.delete(orgId, provider);
  }
}
