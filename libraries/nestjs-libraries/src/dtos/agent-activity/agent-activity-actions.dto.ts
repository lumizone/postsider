import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class BulkApprovalsDto {
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  approvalIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Optional: approval id -> stage position the admin saw. An approval whose
   * current stage differs is skipped (stage_changed) instead of decided.
   * Values are validated in the service.
   */
  @IsOptional()
  @IsObject()
  stages?: Record<string, number>;
}

export class RetryFailedDto {
  @IsOptional()
  @IsBoolean()
  includeUnknownOutcome?: boolean;
}
