import { SetMetadata } from '@nestjs/common';
import { PublicApiScope } from '@postsider/nestjs-libraries/services/public-api-scopes';

export const PUBLIC_API_SCOPES_KEY = 'public-api-scopes';

export const RequirePublicApiScopes = (...scopes: PublicApiScope[]) =>
  SetMetadata(PUBLIC_API_SCOPES_KEY, scopes);
