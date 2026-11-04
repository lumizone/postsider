import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PUBLIC_API_SCOPES } from './public-api-scopes';
import { LEGACY_PUBLIC_API_SCOPES, grantedScopesForOAuth } from './public-api-oauth-scopes';
import { CreateApiKeyDto } from '@postsider/nestjs-libraries/dtos/settings/create-api-key.dto';

describe('policies scopes', () => {
  it('are known scopes appended after audit:read', () => {
    expect(PUBLIC_API_SCOPES).toContain('policies:read');
    expect(PUBLIC_API_SCOPES).toContain('policies:write');
    expect(PUBLIC_API_SCOPES.indexOf('policies:read')).toBeGreaterThan(PUBLIC_API_SCOPES.indexOf('audit:read'));
  });

  it('are never granted implicitly', () => {
    for (const scope of ['policies:read', 'policies:write']) {
      expect(LEGACY_PUBLIC_API_SCOPES).not.toContain(scope);
      expect(grantedScopesForOAuth(['posts:read', 'posts:write', 'channels:write'])).not.toContain(scope);
      expect(grantedScopesForOAuth([scope])).not.toContain(scope);
      expect(grantedScopesForOAuth(undefined)).not.toContain(scope);
    }
  });

  it('can be requested explicitly for an API key', async () => {
    const dto = plainToInstance(CreateApiKeyDto, { name: 'n', scopes: ['policies:write'] });
    expect(await validate(dto)).toHaveLength(0);
  });
});
