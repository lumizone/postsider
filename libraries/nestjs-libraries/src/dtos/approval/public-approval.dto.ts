import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PUBLIC_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type PublicApprovalStatus = (typeof PUBLIC_APPROVAL_STATUSES)[number];

export const APPROVAL_LIST_DEFAULT_LIMIT = 25;
export const APPROVAL_LIST_MAX_LIMIT = 100;
export const APPROVAL_NOTE_MAX = 500;

export class ListApprovalsQueryDto {
  @ApiPropertyOptional({ enum: PUBLIC_APPROVAL_STATUSES })
  @IsOptional()
  @IsIn(PUBLIC_APPROVAL_STATUSES as unknown as string[])
  status?: PublicApprovalStatus;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: APPROVAL_LIST_MAX_LIMIT,
    default: APPROVAL_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(APPROVAL_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor: the nextCursor of a previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ description: 'ISO 8601: only approvals requested at or after this time' })
  @IsOptional()
  @IsISO8601()
  since?: string;
}

export class DecideApprovalDto {
  @ApiPropertyOptional({ maxLength: APPROVAL_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(APPROVAL_NOTE_MAX)
  note?: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'The stage position (stage.position of the approval) you are deciding. When sent and the approval has moved to another stage, nothing is decided and the answer is 409 stage_changed with the current stage. Optional; without it the decision applies to whichever stage is current.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectStage?: number;
}
