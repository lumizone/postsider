import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PUBLIC_API_SCOPES } from './public-api-scopes';
import { LEGACY_PUBLIC_API_SCOPES, grantedScopesForOAuth } from './public-api-oauth-scopes';
import { CreateApiKeyDto } from '@postsider/nestjs-libraries/dtos/settings/create-api-key.dto';

describe('approvals:decide scope', () => {
  it('is a known scope appended after policies:write', () => {
    expect(PUBLIC_API_SCOPES).toContain('approvals:decide');
    expect(PUBLIC_API_SCOPES.indexOf('approvals:decide')).toBeGreaterThan(
      PUBLIC_API_SCOPES.indexOf('policies:write')
    );
  });

  it('is never granted implicitly', () => {
    expect(LEGACY_PUBLIC_API_SCOPES).not.toContain('approvals:decide');
    expect(grantedScopesForOAuth(['posts:read', 'posts:write', 'channels:write'])).not.toContain('approvals:decide');
    expect(grantedScopesForOAuth(['approvals:decide'])).not.toContain('approvals:decide');
    expect(grantedScopesForOAuth(undefined)).not.toContain('approvals:decide');
  });

  it('can be requested explicitly for an API key', async () => {
    const dto = plainToInstance(CreateApiKeyDto, { name: 'n', scopes: ['approvals:decide'] });
    expect(await validate(dto)).toHaveLength(0);
  });
});
