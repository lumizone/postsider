import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
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
}

export class RetryFailedDto {
  @IsOptional()
  @IsBoolean()
  includeUnknownOutcome?: boolean;
}
