import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicAuditActorDto {
  @ApiProperty({ enum: ['USER', 'API_KEY', 'OAUTH_CLIENT', 'SYSTEM', 'GUEST'] })
  type: string;

  @ApiPropertyOptional()
  userId?: string;

  @ApiPropertyOptional()
  apiKeyId?: string;

  @ApiPropertyOptional()
  oauthClientId?: string;
}

export class PublicAuditTargetDto {
  @ApiProperty({ example: 'post' })
  type: string;

  @ApiProperty()
  id: string;
}

export class PublicAuditEventDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'post.published' })
  type: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: PublicAuditActorDto })
  actor: PublicAuditActorDto;

  @ApiProperty({ type: PublicAuditTargetDto })
  target: PublicAuditTargetDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Small primitive facts about the event. Never contains post content.',
  })
  metadata: Record<string, unknown>;
}

export class PublicAuditEventsResponseDto {
  @ApiProperty({ type: [PublicAuditEventDto] })
  events: PublicAuditEventDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
