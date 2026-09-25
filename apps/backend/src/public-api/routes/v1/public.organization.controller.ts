import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { RequirePublicApiScopes } from '@postsider/backend/services/auth/public-api-scope.decorator';

export class PublicOrganizationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: 'PRO' })
  plan: string;
}

type PublicOrganization = Organization & {
  subscription?: { subscriptionTier: string } | null;
};

@ApiTags('Public API')
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Raw PostSider API key or Bearer OAuth access token',
})
@Controller('/public/v1')
@UseGuards(PublicApiScopeGuard)
export class PublicOrganizationController {
  @Get('/organization')
  @RequirePublicApiScopes('organization:read')
  @ApiOkResponse({ type: PublicOrganizationResponseDto })
  getOrganization(@GetOrgFromRequest() organization: PublicOrganization) {
    return {
      id: organization.id,
      name: organization.name,
      plan: organization.subscription?.subscriptionTier ?? 'FREE',
    };
  }
}
