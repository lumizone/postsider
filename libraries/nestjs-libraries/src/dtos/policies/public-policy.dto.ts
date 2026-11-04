import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  POLICY_CONDITIONS,
  POLICY_EFFECTS,
} from '@postsider/nestjs-libraries/policies/policy-types';
import { POST_ACTOR_TYPES } from '@postsider/nestjs-libraries/actor/post-actor';

export class PublicPolicyRuleDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ description: 'Lower runs first.' }) priority: number;
  @ApiProperty({ type: [String], enum: POST_ACTOR_TYPES }) appliesToActorTypes: string[];
  @ApiProperty({ type: [String] }) appliesToApiKeyIds: string[];
  @ApiProperty({ type: [String] }) appliesToIntegrationIds: string[];
  @ApiProperty({ type: [String] }) appliesToProviders: string[];
  @ApiProperty({ enum: POLICY_CONDITIONS }) condition: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) conditionParams: Record<string, unknown>;
  @ApiProperty({ enum: POLICY_EFFECTS }) effect: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PublicPoliciesResponseDto {
  @ApiProperty({ type: [PublicPolicyRuleDto] }) policies: PublicPolicyRuleDto[];
}

export class PublicPolicyDeletedDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: true }) deleted: true;
}

export class PublicPolicyMatchDto {
  @ApiProperty() ruleId: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: POLICY_EFFECTS }) effect: string;
  @ApiProperty({ enum: POLICY_CONDITIONS }) condition: string;
}

export class PublicPolicyChannelEffectDto {
  @ApiProperty() integrationId: string;
  @ApiProperty({ enum: ['ALLOW', 'REQUIRE_APPROVAL', 'BLOCK'] }) effect: string;
}

export class PublicPolicyKeyCheckDto {
  @ApiProperty({ description: 'False when the key limits refuse the action or a channel.' })
  allowed: boolean;
  @ApiPropertyOptional({ enum: ['key_action_not_allowed', 'key_channel_not_allowed'] })
  code?: string;
}

export class PublicPolicyEvaluationDto {
  @ApiProperty({ enum: ['ALLOW', 'REQUIRE_APPROVAL', 'BLOCK'] }) effect: string;
  @ApiProperty({ type: [PublicPolicyMatchDto] }) matched: PublicPolicyMatchDto[];
  @ApiProperty({ type: [PublicPolicyChannelEffectDto] }) channels: PublicPolicyChannelEffectDto[];
  @ApiProperty({ type: PublicPolicyKeyCheckDto }) key: PublicPolicyKeyCheckDto;
}
