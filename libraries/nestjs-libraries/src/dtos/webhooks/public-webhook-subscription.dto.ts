import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import {
  PUBLIC_WEBHOOK_EVENTS,
  PublicWebhookEvent,
} from '@postsider/nestjs-libraries/services/public-webhook-events';

export class CreatePublicWebhookSubscriptionDto {
  @ApiProperty({ example: 'Zapier production' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'https://hooks.example.com/postsider' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  url: string;

  @ApiProperty({ type: [String], enum: PUBLIC_WEBHOOK_EVENTS })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(PUBLIC_WEBHOOK_EVENTS, { each: true })
  events: PublicWebhookEvent[];
}

export class UpdatePublicWebhookSubscriptionDto extends PartialType(
  CreatePublicWebhookSubscriptionDto
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
