import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { RequirePublicApiScopes } from '@postsider/backend/services/auth/public-api-scope.decorator';
import {
  ApprovalService,
  type Decider,
} from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { PublicApiIdempotencyService } from '@postsider/nestjs-libraries/database/prisma/idempotency/public-api-idempotency.service';
import { currentActor } from '@postsider/nestjs-libraries/actor/actor-context';
import {
  DecideApprovalDto,
  ListApprovalsQueryDto,
} from '@postsider/nestjs-libraries/dtos/approval/public-approval.dto';

const DECISION_ERRORS =
  'Errors: 403 self_approval_blocked (the key or client created or requested this approval, or the flow requires a different approver), 403 not_allowed_for_stage (the stage does not allow automation), 403 key_action_not_allowed or key_channel_not_allowed (approving schedules the post, so the key needs the schedule action on its channel), 409 approval_already_resolved (decided the opposite way already), 409 stage_changed (expectStage was sent and the approval is no longer at that stage; the body carries the current stage). Send expectStage (the stage.position you read) so a retry or a stale view can never decide a later stage; it is optional. Deciding the same way twice answers 200 with changed false.';

@ApiTags('Public API Approvals')
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Raw PostSider API key or Bearer OAuth access token',
})
@Controller('/public/v1')
@UseGuards(PublicApiScopeGuard)
export class PublicApprovalsController {
  constructor(
    private _approvals: ApprovalService,
    private _idempotency: PublicApiIdempotencyService
  ) {}

  @Get('/approvals')
  @RequirePublicApiScopes('approvals:read')
  @ApiOperation({
    summary: 'List approvals',
    description:
      'Newest first by requestedAt. Filters: status (PENDING, APPROVED, REJECTED), since (ISO 8601, requestedAt at or after). Cursor paginated: pass nextCursor back as cursor until it is null. Each approval carries its stage progress (stage and stages), the flow and the channel. Never contains guest link material. Requires the approvals:read scope.',
  })
  @ApiOkResponse({ description: '{ approvals: [...], nextCursor: string | null }' })
  @ApiBadRequestResponse({ description: 'Invalid status, limit, since or cursor' })
  async list(@GetOrgFromRequest() org: Organization, @Query() query: ListApprovalsQueryDto) {
    const { items, nextCursor } = await this._approvals.listForApi(org.id, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.since ? { since: query.since } : {}),
    });
    return { approvals: items, nextCursor };
  }

  @Get('/approvals/:id')
  @RequirePublicApiScopes('approvals:read')
  @ApiOperation({
    summary: 'Get an approval',
    description:
      'The approval as listed, plus preview: the post text as plain text cut to 500 characters, so a deciding agent can see what it decides. Requires the approvals:read scope.',
  })
  @ApiOkResponse({ description: 'The approval with a preview' })
  @ApiNotFoundResponse({ description: 'Unknown approval id for this organization' })
  async get(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._approvals.getDetailForApi(org.id, id);
  }

  @Post('/approvals/:id/approve')
  @HttpCode(200)
  @RequirePublicApiScopes('approvals:decide')
  @ApiOperation({
    summary: 'Approve the current stage of an approval',
    description: `Decides the current stage as the calling API key. The post is scheduled only when the last stage is approved; status stays PENDING after an earlier stage. Requires the approvals:decide scope, which is never granted implicitly and never to OAuth clients. A key cannot approve an approval it requested or a post it created. Optional Idempotency-Key header. ${DECISION_ERRORS}`,
  })
  @ApiOkResponse({
    description: '{ approvalId, postId, status, changed, stage: { position, total }, final }',
  })
  @ApiForbiddenResponse({
    description:
      'Scope missing, self_approval_blocked, not_allowed_for_stage, key_action_not_allowed or key_channel_not_allowed',
  })
  @ApiNotFoundResponse({ description: 'Unknown approval id for this organization' })
  @ApiConflictResponse({ description: 'approval_already_resolved, stage_changed (expectStage no longer current), or an Idempotency-Key conflict' })
  approve(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: DecideApprovalDto,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.decide(org, id, 'approve', body, idempotencyKey);
  }

  @Post('/approvals/:id/reject')
  @HttpCode(200)
  @RequirePublicApiScopes('approvals:decide')
  @ApiOperation({
    summary: 'Reject an approval',
    description: `Rejects the approval at its current stage; the approval is final and the post stays a draft. Requires the approvals:decide scope, which is never granted implicitly and never to OAuth clients. Optional Idempotency-Key header. ${DECISION_ERRORS}`,
  })
  @ApiOkResponse({
    description: '{ approvalId, postId, status, changed, stage: { position, total }, final }',
  })
  @ApiForbiddenResponse({
    description: 'Scope missing, self_approval_blocked or not_allowed_for_stage',
  })
  @ApiNotFoundResponse({ description: 'Unknown approval id for this organization' })
  @ApiConflictResponse({ description: 'approval_already_resolved, stage_changed (expectStage no longer current), or an Idempotency-Key conflict' })
  reject(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: DecideApprovalDto,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.decide(org, id, 'reject', body, idempotencyKey);
  }

  private async decide(
    org: Organization,
    id: string,
    decision: 'approve' | 'reject',
    body: DecideApprovalDto | undefined,
    idempotencyKey: string | undefined
  ) {
    // The verified credential of this request (set by the public auth
    // middleware), never anything the caller claims in the body.
    const actor = currentActor();
    if (actor.type !== 'API_KEY' && actor.type !== 'OAUTH_CLIENT') {
      throw new ForbiddenException({
        error: 'not_allowed_for_stage',
        reason: 'unsupported_actor',
        msg: 'Only an API key can decide an approval through the public API.',
      });
    }
    const note = typeof body?.note === 'string' ? body.note : null;
    const decider: Decider = { actor, via: 'API' };

    const expectStage =
      typeof body?.expectStage === 'number' ? body.expectStage : undefined;
    const claim = await this._idempotency.claim(org.id, idempotencyKey, {
      approvalId: id,
      decision,
      note,
      ...(expectStage !== undefined ? { expectStage } : {}),
    });
    if (claim?.kind === 'replay') return claim.response;
    try {
      const result = await this._approvals.decide(org.id, id, decider, decision, {
        note,
        ...(expectStage !== undefined ? { expectStage, strictStage: true } : {}),
      });
      if (claim?.kind === 'new') await this._idempotency.complete(claim.id, result);
      return result;
    } catch (error) {
      if (claim?.kind === 'new') await this._idempotency.release(claim.id);
      throw error;
    }
  }
}
