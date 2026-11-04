import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  PUBLIC_API_SCOPES,
  PublicApiScope,
} from '@postsider/nestjs-libraries/services/public-api-scopes';
import {
  POST_ACTIONS,
  PostActionName,
} from '@postsider/nestjs-libraries/policies/policy-types';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'n8n production' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    type: [String],
    enum: PUBLIC_API_SCOPES,
    description:
      'Defaults to the legacy scopes (everything except webhooks:* and audit:read). audit:read and webhooks:* are never granted by default.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(PUBLIC_API_SCOPES, { each: true })
  scopes?: PublicApiScope[];

  @ApiPropertyOptional({
    type: [String],
    enum: POST_ACTIONS,
    description:
      'Post actions this key may perform. An empty list (the default) means all of them.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(POST_ACTIONS, { each: true })
  allowedActions?: PostActionName[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Channel ids this key may post to. An empty list (the default) means every channel.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  allowedIntegrationIds?: string[];
}

export class UpdateApiKeyDto extends PartialType(CreateApiKeyDto) {}
