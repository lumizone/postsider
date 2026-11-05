import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { HttpException } from '@nestjs/common';
import {
  AUDIT_EVENT_TYPES,
  AuditEventType,
} from '@postsider/nestjs-libraries/database/prisma/audit/audit-events';

export const AUDIT_DEFAULT_LIMIT = 25;

export class ListAuditEventsDto {
  @ApiPropertyOptional({ example: 'post' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  targetType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetId?: string;

  @ApiPropertyOptional({ enum: AUDIT_EVENT_TYPES })
  @IsOptional()
  @IsIn(AUDIT_EVENT_TYPES as readonly string[])
  type?: AuditEventType;

  @ApiPropertyOptional({ description: 'ISO 8601, inclusive lower bound' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601, inclusive upper bound' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: AUDIT_DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

/** Activity route: the target is the path post, so no target filters. */
export class ListPostActivityDto extends OmitType(ListAuditEventsDto, [
  'targetType',
  'targetId',
] as const) {}

/** Shared by both audit routes: default limit and a from <= to check. */
export function resolveAuditPaging(query: Omit<ListAuditEventsDto, 'targetType' | 'targetId'>): {
  limit: number;
  cursor?: string;
  from?: Date;
  to?: Date;
  type?: AuditEventType;
} {
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    throw new HttpException({ msg: 'Invalid date' }, 400);
  }
  if (from && to && from > to) {
    throw new HttpException({ msg: '"from" must not be after "to"' }, 400);
  }
  return {
    limit: query.limit ?? AUDIT_DEFAULT_LIMIT,
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(query.type ? { type: query.type } : {}),
  };
}
