import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  POLICY_CONDITIONS,
  POLICY_EFFECTS,
  PolicyConditionName,
  PolicyEffectName,
} from '@postsider/nestjs-libraries/policies/policy-types';
import {
  POST_ACTOR_TYPES,
  PostActorType,
} from '@postsider/nestjs-libraries/actor/post-actor';

export class CreatePolicyRuleDto {
  @ApiProperty({ example: 'Links need approval' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({ description: 'Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Lower runs first. 0 to 1000, defaults to 100.',
    minimum: 0,
    maximum: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @ApiPropertyOptional({
    type: [String],
    enum: POST_ACTOR_TYPES,
    description: 'Actor types the rule applies to. Empty means all.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsIn(POST_ACTOR_TYPES, { each: true })
  appliesToActorTypes?: PostActorType[];

  @ApiPropertyOptional({ type: [String], description: 'API key ids. Empty means all.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  appliesToApiKeyIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Channel ids. Empty means all.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  appliesToIntegrationIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Provider identifiers. Empty means all.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  appliesToProviders?: string[];

  @ApiProperty({ enum: POLICY_CONDITIONS })
  @IsIn(POLICY_CONDITIONS)
  condition: PolicyConditionName;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Parameters for the condition. Validated per condition.',
  })
  @IsOptional()
  @IsObject()
  conditionParams?: Record<string, unknown>;

  @ApiProperty({ enum: POLICY_EFFECTS })
  @IsIn(POLICY_EFFECTS)
  effect: PolicyEffectName;
}

export class UpdatePolicyRuleDto extends PartialType(CreatePolicyRuleDto) {}
