import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PUBLIC_API_SCOPES } from './public-api-scopes';
import { LEGACY_PUBLIC_API_SCOPES, grantedScopesForOAuth } from './public-api-oauth-scopes';
import { CreateApiKeyDto } from '@postsider/nestjs-libraries/dtos/settings/create-api-key.dto';

describe('audit:read scope', () => {
  it('is a known scope', () => {
    expect(PUBLIC_API_SCOPES).toContain('audit:read');
  });

  it('is never granted implicitly', () => {
    expect(LEGACY_PUBLIC_API_SCOPES).not.toContain('audit:read');
    expect(grantedScopesForOAuth(['posts:read', 'posts:write', 'channels:write'])).not.toContain('audit:read');
    expect(grantedScopesForOAuth(['audit:read'])).not.toContain('audit:read');
    expect(grantedScopesForOAuth(undefined)).not.toContain('audit:read');
  });

  it('can be requested explicitly for an API key', async () => {
    const dto = plainToInstance(CreateApiKeyDto, { name: 'n', scopes: ['audit:read'] });
    expect(await validate(dto)).toHaveLength(0);
  });
});
