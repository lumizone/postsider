import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { RequirePublicApiScopes } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { CustomerService } from '@postsider/nestjs-libraries/database/prisma/integrations/customer.service';
import { PublicApiIdempotencyService } from '@postsider/nestjs-libraries/database/prisma/idempotency/public-api-idempotency.service';
import { CustomerNameDto } from '@postsider/nestjs-libraries/dtos/customers/customer.dto';
import { assertAdmin } from '@postsider/backend/public-api/routes/v1/assert-admin';

/** Explicit allow-list: the row's organization id and anything else never leaves. */
const shape = (c: { id: string; name: string; createdAt: Date; channelCount?: number }) => ({
  id: c.id,
  name: c.name,
  ...(c.channelCount === undefined ? {} : { channelCount: c.channelCount }),
  createdAt: c.createdAt,
});

/**
 * Customers (workspaces): list, create, rename and archive, so an agency can
 * provision a client and then assign channels to it by id. Creating
 * organizations, inviting members and connecting channels are not here.
 */
@ApiTags('Public API Customers')
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Raw PostSider API key or Bearer OAuth access token',
})
@Controller('/public/v1')
@UseGuards(PublicApiScopeGuard)
export class PublicCustomersController {
  constructor(
    private _customers: CustomerService,
    private _idempotency: PublicApiIdempotencyService
  ) {}

  @Get('/customers')
  @RequirePublicApiScopes('channels:read')
  @ApiOperation({
    summary: 'List customers',
    description: 'Live customers of the organization with the number of channels assigned to each.',
  })
  @ApiOkResponse({ description: '{ customers: [{ id, name, channelCount, createdAt }] }' })
  async list(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    const rows = await this._customers.list(org.id);
    return { customers: rows.map(shape) };
  }

  @Post('/customers')
  @RequirePublicApiScopes('channels:write')
  @ApiOperation({
    summary: 'Create a customer',
    description:
      'Needs an ADMIN or owner role. Idempotent by name: an existing live customer with the same name is returned with status 200 instead of 201. At most 200 customers per organization (error customer_limit_reached). Honors the Idempotency-Key header.',
  })
  @ApiCreatedResponse({ description: 'The customer was created' })
  @ApiOkResponse({ description: 'A customer with this name already existed' })
  @ApiBadRequestResponse({ description: 'Invalid name, or error customer_limit_reached' })
  async create(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CustomerNameDto,
    @Res({ passthrough: true }) res: { status: (code: number) => unknown },
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    assertAdmin(org);
    const name = body.name;
    const claim = await this._idempotency.claim(org.id, idempotencyKey, { name });
    if (claim?.kind === 'replay') {
      res.status(200);
      return claim.response;
    }
    try {
      const { customer, created } = await this._customers.create(org.id, name);
      const response = shape(customer);
      res.status(created ? 201 : 200);
      if (claim) await this._idempotency.complete(claim.id, response);
      return response;
    } catch (error) {
      if (claim) await this._idempotency.release(claim.id);
      throw error;
    }
  }

  @Put('/customers/:id')
  @RequirePublicApiScopes('channels:write')
  @ApiOperation({
    summary: 'Rename a customer',
    description: 'Needs an ADMIN or owner role.',
  })
  @ApiOkResponse({ description: 'The renamed customer' })
  @ApiNotFoundResponse({ description: 'Unknown, foreign or archived customer id' })
  @ApiConflictResponse({ description: 'error customer_name_taken' })
  async rename(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: CustomerNameDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    assertAdmin(org);
    return shape(await this._customers.rename(org.id, id, body.name));
  }

  @Post('/customers/:id/archive')
  @HttpCode(200)
  @RequirePublicApiScopes('channels:write')
  @ApiOperation({
    summary: 'Archive a customer',
    description:
      'Needs an ADMIN or owner role. Detaches the channels of the customer and keeps every channel and post. A second archive answers 404.',
  })
  @ApiOkResponse({ description: '{ id, archived: true, detachedChannels }' })
  @ApiNotFoundResponse({ description: 'Unknown, foreign or already archived customer id' })
  async archive(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    Sentry.metrics.count('public_api-request', 1);
    assertAdmin(org);
    return this._customers.archive(org.id, id);
  }
}
