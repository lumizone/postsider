import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
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
}

export class UpdateApiKeyDto extends PartialType(CreateApiKeyDto) {}
